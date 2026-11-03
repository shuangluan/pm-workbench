// Claims, the evidence registry handed to the model, and structural validation
// of model output (PRD §3.2, §3.3, §6.2).

import { normalizeText, type Evidence } from "./evidence";
import type { ClaimKind, EvidenceValidity, RejectReason, ReviewStatus } from "./types";

/** Report section a claim belongs to. Abstraction sections follow F06; impact sections follow F07. */
export type ClaimSection =
  | "common_problem"
  | "capability"
  | "configuration"
  | "conflict"
  | "uncovered"
  | "risk"
  | "impact_confirmed"
  | "impact_possible"
  | "impact_unknown"
  | "checklist"
  | "spec";

export const CLAIM_TEXT_MAX = 2_000;

/** A citation as the model returns it: a server-issued handle and, optionally, the quote it relied on. */
export interface EvidenceRef {
  handle: string;
  quote?: string;
}

export interface ClaimDraft {
  section: ClaimSection;
  kind: ClaimKind;
  text: string;
  evidence: EvidenceRef[];
  /** Required for inference and suggestion: why the model concluded this. */
  reasoning?: string;
  /** Required for unknown: what is missing and who could supply it. */
  missing?: string;
  /** Required for confirmed_relation: the confirmed edge it reports. */
  edgeId?: string;
  /** Requests this claim speaks for, by handle (R1, R2...). */
  requestHandles?: string[];
  /** Absent means model output. User-written claims are shown as user input, not as source text. */
  origin?: "model" | "user";
}

export interface RegistryEntry {
  handle: string;
  evidenceId: string;
  productId: string;
  sourceVersionId: string;
  quote: string;
  validity: EvidenceValidity;
}

/**
 * The only citations a model may use. Handles are short and assigned here so the
 * model never sees, and so cannot fabricate, database ids or URLs.
 */
export class EvidenceRegistry {
  private readonly byHandle = new Map<string, RegistryEntry>();

  constructor(entries: { evidence: Evidence; validity: EvidenceValidity }[]) {
    const sorted = [...entries].sort((a, b) =>
      a.evidence.sourceVersionId === b.evidence.sourceVersionId
        ? a.evidence.start - b.evidence.start
        : a.evidence.sourceVersionId < b.evidence.sourceVersionId
          ? -1
          : 1,
    );
    sorted.forEach(({ evidence, validity }, i) => {
      const handle = `E${i + 1}`;
      this.byHandle.set(handle, {
        handle,
        evidenceId: evidence.id,
        productId: evidence.productId,
        sourceVersionId: evidence.sourceVersionId,
        quote: evidence.quote,
        validity,
      });
    });
  }

  get(handle: string): RegistryEntry | undefined {
    return this.byHandle.get(handle);
  }

  entries(): RegistryEntry[] {
    return [...this.byHandle.values()];
  }

  /** Text block given to the model. Source text is data; the template keeps it fenced off from instructions. */
  toPromptBlock(): string {
    return this.entries()
      .map((e) => `[${e.handle}] ${JSON.stringify(e.quote)}`)
      .join("\n");
  }
}

export type ValidationCode =
  | "unknown_evidence"
  | "cross_product_evidence"
  | "evidence_not_current"
  | "quote_mismatch"
  | "missing_evidence"
  | "missing_reasoning"
  | "missing_gap"
  | "unconfirmed_relation"
  | "unknown_request"
  | "text_empty"
  | "text_too_long";

export interface ValidationIssue {
  claimIndex: number;
  code: ValidationCode;
  detail?: string;
}

export interface ValidationContext {
  productId: string;
  registry: EvidenceRegistry;
  confirmedEdgeIds: ReadonlySet<string>;
  requestHandles: ReadonlySet<string>;
}

/**
 * Structural checks only. Passing proves citations are real and in scope; it
 * does not prove a citation supports its claim. That stays a human judgement.
 */
export function validateClaims(claims: readonly ClaimDraft[], ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  claims.forEach((claim, claimIndex) => {
    const add = (code: ValidationCode, detail?: string) => issues.push({ claimIndex, code, ...(detail ? { detail } : {}) });

    if (claim.text.trim() === "") add("text_empty");
    if (claim.text.length > CLAIM_TEXT_MAX) add("text_too_long");

    for (const ref of claim.evidence) {
      const entry = ctx.registry.get(ref.handle);
      if (!entry) {
        add("unknown_evidence", ref.handle);
        continue;
      }
      if (entry.productId !== ctx.productId) add("cross_product_evidence", ref.handle);
      if (entry.validity !== "valid") add("evidence_not_current", ref.handle);
      if (ref.quote !== undefined && !entry.quote.includes(normalizeText(ref.quote).trim())) {
        add("quote_mismatch", ref.handle);
      }
    }
    for (const r of claim.requestHandles ?? []) {
      if (!ctx.requestHandles.has(r)) add("unknown_request", r);
    }

    const hasReasoning = (claim.reasoning ?? "").trim() !== "";
    switch (claim.kind) {
      case "source_fact":
        if (claim.evidence.length === 0) add("missing_evidence");
        break;
      case "inference":
        if (claim.evidence.length === 0) add("missing_evidence");
        if (!hasReasoning) add("missing_reasoning");
        break;
      case "suggestion":
        if (!hasReasoning) add("missing_reasoning");
        break;
      case "unknown":
        if ((claim.missing ?? "").trim() === "") add("missing_gap");
        break;
      case "confirmed_relation":
        if (!claim.edgeId || !ctx.confirmedEdgeIds.has(claim.edgeId)) add("unconfirmed_relation", claim.edgeId);
        break;
    }
  });
  return issues;
}

export interface ClaimRecord extends ClaimDraft {
  id: string;
  review: ReviewStatus;
  revision: number;
  /** The model's original output, kept untouched once the user corrects it (F08). */
  original?: { text: string; kind: ClaimKind };
  rejectReason?: RejectReason;
  rejectNote?: string;
  reviewedAt?: string;
  /** Validity of the weakest cited evidence, refreshed when sources change. */
  evidenceValidity: EvidenceValidity;
}

export class RevisionConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`revision conflict: expected ${expected}, found ${actual}`);
  }
}

export type ReviewAction =
  | { type: "accept" }
  | { type: "correct"; text: string; kind?: ClaimKind }
  | { type: "reject"; reason: RejectReason; note?: string }
  | { type: "reopen" };

/** Apply a review action with optimistic locking. Accepting never changes a claim's kind. */
export function reviewClaim(claim: ClaimRecord, action: ReviewAction, expectedRevision: number, now: string): ClaimRecord {
  if (claim.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, claim.revision);
  const base = { ...claim, revision: claim.revision + 1, reviewedAt: now };
  switch (action.type) {
    case "accept":
      return { ...base, review: "accepted", rejectReason: undefined, rejectNote: undefined };
    case "correct": {
      if (action.text.trim() === "") throw new Error("corrected text must not be empty");
      return {
        ...base,
        review: "corrected",
        original: claim.original ?? { text: claim.text, kind: claim.kind },
        text: action.text,
        kind: action.kind ?? claim.kind,
        rejectReason: undefined,
        rejectNote: undefined,
      };
    }
    case "reject":
      if (action.reason === "other" && !action.note?.trim()) throw new Error("rejecting with 'other' needs a note");
      return { ...base, review: "rejected", rejectReason: action.reason, rejectNote: action.note };
    case "reopen":
      return { ...base, review: "pending" };
  }
}

/** Weakest validity wins: one deleted source marks the claim for re-review. */
export function claimEvidenceValidity(validities: readonly EvidenceValidity[]): EvidenceValidity {
  if (validities.includes("source_deleted")) return "source_deleted";
  if (validities.includes("needs_review")) return "needs_review";
  return "valid";
}
