// Claims for an analysis and their review (PRD §3.2, F08). M1 has no model,
// so claims here are user-written; they go through the same validator as
// model output and are labelled as user input.

import {
  claimEvidenceValidity,
  EvidenceRegistry,
  reviewClaim,
  RevisionConflictError,
  validateClaims,
  type ClaimKind,
  type ClaimRecord,
  type ClaimSection,
  type EvidenceValidity,
  type ReviewAction,
} from "@pew/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { AppError, newId, notFound, revisionConflict } from "../errors";
import { analysisRuns, claimEvidences, claims, evidences, sourceVersions, systemEdges } from "../schema";
import { getAnalysis } from "./analyses";

export const CLAIM_SECTIONS: ClaimSection[] = [
  "common_problem",
  "capability",
  "configuration",
  "conflict",
  "uncovered",
  "risk",
  "impact_possible",
  "impact_unknown",
  "checklist",
  "spec",
];

async function manualRunId(db: Db, productId: string, analysisId: string): Promise<string> {
  const key = `manual:${analysisId}`;
  const [existing] = await db.select({ id: analysisRuns.id }).from(analysisRuns).where(eq(analysisRuns.idempotencyKey, key));
  if (existing) return existing.id;
  const [row] = await db
    .insert(analysisRuns)
    .values({
      id: newId("run"),
      productId,
      analysisId,
      taskType: "manual",
      status: "succeeded",
      idempotencyKey: key,
      inputSnapshot: {},
      finishedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: analysisRuns.id });
  if (row) return row.id;
  return (await db.select({ id: analysisRuns.id }).from(analysisRuns).where(eq(analysisRuns.idempotencyKey, key)))[0]!.id;
}

async function evidenceRows(db: Db, productId: string, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({
      id: evidences.id,
      productId: evidences.productId,
      sourceVersionId: evidences.sourceVersionId,
      charStart: evidences.charStart,
      charEnd: evidences.charEnd,
      lineStart: evidences.lineStart,
      lineEnd: evidences.lineEnd,
      quote: evidences.quote,
      quoteHash: evidences.quoteHash,
      validity: sourceVersions.validity,
    })
    .from(evidences)
    .innerJoin(sourceVersions, eq(sourceVersions.id, evidences.sourceVersionId))
    .where(and(eq(evidences.productId, productId), inArray(evidences.id, ids)));
}

export interface UserClaimInput {
  section: ClaimSection;
  kind: ClaimKind;
  text: string;
  reasoning?: string;
  missing?: string;
  evidenceIds: string[];
  edgeId?: string;
}

export async function addUserClaim(db: Db, productId: string, analysisId: string, input: UserClaimInput) {
  const analysis = await getAnalysis(db, productId, analysisId);
  if (analysis.status === "archived") throw new AppError("invalid_input", "已归档的分析不能修改");
  if (!CLAIM_SECTIONS.includes(input.section)) throw new AppError("invalid_input", "未知的条目分区");
  const evidenceIds = [...new Set(input.evidenceIds)];
  const rows = await evidenceRows(db, productId, evidenceIds);
  if (rows.length !== evidenceIds.length) throw notFound("引用");

  const registry = new EvidenceRegistry(
    rows.map((r) => ({
      evidence: { id: r.id, productId: r.productId, sourceVersionId: r.sourceVersionId, start: r.charStart, end: r.charEnd, lineStart: r.lineStart, lineEnd: r.lineEnd, quote: r.quote ?? "", hash: r.quoteHash },
      validity: r.validity,
    })),
  );
  const handles = registry.entries();
  const confirmedEdgeIds = new Set(
    (
      await db
        .select({ id: systemEdges.id })
        .from(systemEdges)
        .where(and(eq(systemEdges.productId, productId), eq(systemEdges.confirmation, "confirmed"), eq(systemEdges.validity, "valid")))
    ).map((e) => e.id),
  );
  const draft = {
    section: input.section,
    kind: input.kind,
    text: input.text.trim(),
    evidence: handles.map((h) => ({ handle: h.handle })),
    reasoning: input.reasoning?.trim() || undefined,
    missing: input.missing?.trim() || undefined,
    edgeId: input.edgeId || undefined,
  };
  const issues = validateClaims([draft], { productId, registry, confirmedEdgeIds, requestHandles: new Set() });
  if (issues.length) throw new AppError("invalid_input", CLAIM_ISSUE_MESSAGES[issues[0]!.code] ?? issues[0]!.code, { issues });

  const runId = await manualRunId(db, productId, analysisId);
  const existing = await db.select({ id: claims.id }).from(claims).where(eq(claims.runId, runId));
  const id = newId("cl");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(claims).values({
      id,
      productId,
      runId,
      position: existing.length,
      section: draft.section,
      kind: draft.kind,
      origin: "user",
      text: draft.text,
      reasoning: draft.reasoning ?? null,
      missing: draft.missing ?? null,
      edgeId: draft.edgeId ?? null,
      // The user wrote it, so it counts as reviewed; it can still be corrected or rejected later.
      review: "accepted",
      reviewedAt: now,
      evidenceValidity: claimEvidenceValidity(rows.map((r) => r.validity)),
    });
    if (handles.length) {
      await tx.insert(claimEvidences).values(handles.map((h, position) => ({ productId, claimId: id, evidenceId: h.evidenceId, position })));
    }
  });
  return id;
}

const CLAIM_ISSUE_MESSAGES: Partial<Record<string, string>> = {
  missing_evidence: "“原文事实”和“推断”至少需要一条引用",
  missing_reasoning: "“推断”和“建议”需要填写理由",
  missing_gap: "“未知”需要说明缺少什么、找谁补充",
  unconfirmed_relation: "“已确认关系”只能引用已确认的关系",
  evidence_not_current: "引用的资料版本已过期或已删除",
  text_empty: "内容不能为空",
  text_too_long: "内容过长",
};

export interface ClaimView extends ClaimRecord {
  evidenceIds: string[];
  runId: string;
  taskType: string;
}

export async function listClaims(db: Db, productId: string, analysisId: string): Promise<ClaimView[]> {
  const rows = await db
    .select({ claim: claims, taskType: analysisRuns.taskType })
    .from(claims)
    .innerJoin(analysisRuns, eq(analysisRuns.id, claims.runId))
    .where(and(eq(claims.productId, productId), eq(analysisRuns.analysisId, analysisId)))
    .orderBy(asc(analysisRuns.createdAt), asc(claims.position));
  const links = rows.length
    ? await db
        .select()
        .from(claimEvidences)
        .where(inArray(claimEvidences.claimId, rows.map((r) => r.claim.id)))
        .orderBy(asc(claimEvidences.position))
    : [];
  return rows.map(({ claim: c, taskType }) => {
    const evidenceIds = links.filter((l) => l.claimId === c.id).map((l) => l.evidenceId);
    return {
      id: c.id,
      runId: c.runId,
      taskType,
      section: c.section as ClaimSection,
      kind: c.kind,
      origin: c.origin,
      text: c.text,
      reasoning: c.reasoning ?? undefined,
      missing: c.missing ?? undefined,
      edgeId: c.edgeId ?? undefined,
      // Handles are assigned per report; ids are carried alongside until then.
      evidence: evidenceIds.map((id) => ({ handle: id })),
      evidenceIds,
      review: c.review,
      revision: c.revision,
      original: c.originalText ? { text: c.originalText, kind: (c.originalKind ?? c.kind) as ClaimKind } : undefined,
      rejectReason: c.rejectReason ?? undefined,
      rejectNote: c.rejectNote ?? undefined,
      reviewedAt: c.reviewedAt?.toISOString(),
      evidenceValidity: c.evidenceValidity as EvidenceValidity,
    };
  });
}

/** Review with optimistic locking: the UPDATE only applies if the revision still matches. */
export async function reviewClaimById(db: Db, productId: string, claimId: string, action: ReviewAction, expectedRevision: number) {
  const [row] = await db.select().from(claims).where(and(eq(claims.productId, productId), eq(claims.id, claimId)));
  if (!row) throw notFound("条目");
  let next: ClaimRecord;
  try {
    next = reviewClaim(
      {
        id: row.id,
        section: row.section as ClaimSection,
        kind: row.kind,
        text: row.text,
        evidence: [],
        review: row.review,
        revision: row.revision,
        original: row.originalText ? { text: row.originalText, kind: (row.originalKind ?? row.kind) as ClaimKind } : undefined,
        evidenceValidity: row.evidenceValidity,
      },
      action,
      expectedRevision,
      new Date().toISOString(),
    );
  } catch (err) {
    if (err instanceof RevisionConflictError) throw revisionConflict();
    throw new AppError("invalid_input", err instanceof Error ? err.message : String(err));
  }
  const updated = await db
    .update(claims)
    .set({
      review: next.review,
      kind: next.kind,
      text: next.text,
      originalText: next.original?.text ?? null,
      originalKind: next.original?.kind ?? null,
      rejectReason: next.review === "rejected" ? next.rejectReason! : null,
      rejectNote: next.review === "rejected" ? next.rejectNote ?? null : null,
      reviewedAt: new Date(next.reviewedAt!),
      revision: next.revision,
    })
    .where(and(eq(claims.id, claimId), eq(claims.revision, expectedRevision)))
    .returning({ id: claims.id });
  if (!updated.length) throw revisionConflict();
}
