// Analysis and AI run lifecycles, retry policy and input budget (PRD §5 F02, §6.1, §7.2, §11).

export type AnalysisStatus = "draft" | "pending_review" | "report_saved" | "archived";

const ANALYSIS_TRANSITIONS: Record<AnalysisStatus, readonly AnalysisStatus[]> = {
  // Saving a report straight from draft is allowed: the snapshot itself records "draft" status.
  draft: ["pending_review", "report_saved", "archived"],
  pending_review: ["draft", "report_saved", "archived"],
  report_saved: ["draft", "pending_review", "archived"],
  archived: ["draft"],
};

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";

const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["running", "canceled"],
  running: ["succeeded", "failed", "canceled", "interrupted"],
  succeeded: [],
  failed: [],
  canceled: [],
  interrupted: [],
};

export class InvalidTransitionError extends Error {
  constructor(readonly from: string, readonly to: string) {
    super(`invalid transition ${from} -> ${to}`);
  }
}

export function transitionAnalysis(from: AnalysisStatus, to: AnalysisStatus): AnalysisStatus {
  if (!ANALYSIS_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError(from, to);
  return to;
}

export function transitionRun(from: RunStatus, to: RunStatus): RunStatus {
  if (!RUN_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError(from, to);
  return to;
}

export function isTerminal(status: RunStatus): boolean {
  return RUN_TRANSITIONS[status].length === 0;
}

/**
 * A model response may arrive after the user canceled or the worker marked the
 * run interrupted. Only a still-running run may take a result.
 */
export function canAcceptResult(status: RunStatus): boolean {
  return status === "running";
}

export type ModelErrorKind =
  | "auth"
  | "model_not_found"
  | "unsupported_format"
  | "network"
  | "invalid_output"
  | "rate_limited"
  | "outcome_unknown"
  | "budget_exceeded"
  | "truncated"
  | "refused"
  | "canceled";

/** At most one automatic retry, and only where re-sending cannot double-charge silently. */
export function shouldAutoRetry(kind: ModelErrorKind, attemptsSoFar: number): boolean {
  if (attemptsSoFar >= 2) return false;
  return kind === "network" || kind === "invalid_output" || kind === "rate_limited";
}

/** Runs without a heartbeat for this long are marked interrupted on worker start. */
export const HEARTBEAT_STALE_MS = 60_000;

export function isHeartbeatStale(lastHeartbeatAt: Date, now: Date): boolean {
  return now.getTime() - lastHeartbeatAt.getTime() > HEARTBEAT_STALE_MS;
}

/**
 * Fixed overhead a structured-output request adds beyond the system prompt,
 * the user text and the schema itself. Calibrated on one real call
 * (claude-opus-5-5, 2026-11-13: estimate without it 1,746, actual 2,283);
 * revisit when more calls are measured.
 */
export const STRUCTURED_OUTPUT_OVERHEAD_TOKENS = 600;

/** Input estimate for one structured call: system + text + schema + overhead. */
export function estimateRequestTokens(parts: { system: string; text: string; schema: object }): number {
  return estimateTokens(parts.system) + estimateTokens(parts.text) + estimateTokens(JSON.stringify(parts.schema)) + STRUCTURED_OUTPUT_OVERHEAD_TOKENS;
}

/**
 * Conservative token estimate when no provider tokenizer is available: one token
 * per CJK character, one per three other characters, rounded up. Errs high.
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[　-鿿가-힯豈-﫿＀-￯]/.test(ch)) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 3);
}

export interface BudgetInput {
  inputTokens: number;
  contextLimit: number;
  outputLimit: number;
  /** Fraction of the context kept free for template and schema. */
  safetyMargin?: number;
}

export type BudgetResult = { ok: true; headroom: number } | { ok: false; overBy: number };

/** Refuse oversize input up front instead of truncating it silently (F04, §6.3). */
export function checkBudget({ inputTokens, contextLimit, outputLimit, safetyMargin = 0.1 }: BudgetInput): BudgetResult {
  const available = Math.floor(contextLimit * (1 - safetyMargin)) - outputLimit;
  return inputTokens <= available ? { ok: true, headroom: available - inputTokens } : { ok: false, overBy: inputTokens - available };
}

export interface Pricing {
  inputPerMillion?: number;
  outputPerMillion?: number;
}

/** Unknown stays unknown: returns null rather than 0 when a price or count is missing (F09). */
export function estimateCost(usage: { inputTokens?: number; outputTokens?: number }, price: Pricing): number | null {
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
  if (price.inputPerMillion === undefined || price.outputPerMillion === undefined) return null;
  return (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion) / 1_000_000;
}

export const STALE_MEMORY_DAYS = 90;

/** Memory not reviewed for 90 days is flagged, never auto-judged wrong or deleted (F05). */
export function isMemoryStale(lastReviewedAt: Date, now: Date, days = STALE_MEMORY_DAYS): boolean {
  return now.getTime() - lastReviewedAt.getTime() > days * 86_400_000;
}
