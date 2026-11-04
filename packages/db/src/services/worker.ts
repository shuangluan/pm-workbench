// Background execution of model runs (PRD §6.1). The Postgres row is the
// queue. One run at a time per instance; other runs wait. With PGlite the
// worker runs inside the web process; with Postgres it can run as apps/worker.

import {
  ABSTRACTION_SCHEMA,
  ABSTRACTION_SYSTEM,
  abstractionPrompt,
  canAcceptResult,
  claimEvidenceValidity,
  estimateCost,
  HEARTBEAT_STALE_MS,
  isHeartbeatStale,
  parseAbstraction,
  parseSplit,
  parseTranscript,
  shouldAutoRetry,
  SPLIT_SCHEMA,
  SPLIT_SYSTEM,
  splitPrompt,
  TRANSCRIBE_PROMPT,
  TRANSCRIBE_SCHEMA,
  TRANSCRIBE_SYSTEM,
  type EvidenceValidity,
  type ModelErrorKind,
  type ParseResult,
} from "@pew/core";
import { callModel, ModelError, type CallModel, type ModelRequest } from "@pew/model-adapters";
import { and, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "../client";
import { AppError, newId } from "../errors";
import { analyses, analysisRuns, claimEvidences, claims, usageRecords } from "../schema";
import { appendToScope } from "./analyses";
import { readImage, saveTranscript } from "./media";
import { resolveModelEndpoint } from "./models";
import { candidateFor, registryFor, type RunInput } from "./runs";
import { ensureEvidence } from "./sources";

export interface WorkerDeps {
  db: Db;
  dataDir: string;
  call?: CallModel;
  /** How often a running task reports in and checks for cancellation. */
  heartbeatMs?: number;
}

type Run = typeof analysisRuns.$inferSelect;

/** Claim the oldest queued run, unless one is already running. */
async function claimNext(db: Db): Promise<Run | null> {
  return db.transaction(async (tx) => {
    const [busy] = await tx.select({ id: analysisRuns.id }).from(analysisRuns).where(eq(analysisRuns.status, "running")).limit(1);
    if (busy) return null;
    const [next] = await tx
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.status, "queued"))
      .orderBy(analysisRuns.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    const now = new Date();
    const [claimed] = await tx
      .update(analysisRuns)
      .set({ status: "running", startedAt: now, heartbeatAt: now })
      .where(and(eq(analysisRuns.id, next.id), eq(analysisRuns.status, "queued")))
      .returning();
    return claimed ?? null;
  });
}

/**
 * Runs with no recent heartbeat lost their worker. They are marked interrupted,
 * never re-sent: the provider may already have done (and billed) the work.
 */
export async function recoverInterruptedRuns(db: Db, { all = false, now = new Date() } = {}) {
  const running = await db.select().from(analysisRuns).where(eq(analysisRuns.status, "running"));
  const lost = running.filter((r) => all || !r.heartbeatAt || isHeartbeatStale(r.heartbeatAt, now));
  if (!lost.length) return 0;
  await db
    .update(analysisRuns)
    .set({ status: "interrupted", finishedAt: now, errorKind: "interrupted", errorMessage: "服务在任务运行时重启，结果未知。重试可能产生额外费用。" })
    .where(and(inArray(analysisRuns.id, lost.map((r) => r.id)), eq(analysisRuns.status, "running")));
  return lost.length;
}

async function finishFailed(db: Db, runId: string, kind: ModelErrorKind | string, message: string) {
  await db
    .update(analysisRuns)
    .set({ status: "failed", finishedAt: new Date(), errorKind: kind, errorMessage: message.slice(0, 500) })
    .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.status, "running")));
}

/** Atomic success: only a still-running run may take a result, so a late answer changes nothing. */
async function finishSucceeded(db: Db, runId: string, write: (tx: Tx) => Promise<unknown>) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ status: analysisRuns.status }).from(analysisRuns).where(eq(analysisRuns.id, runId)).for("update");
    if (!row || !canAcceptResult(row.status)) return;
    const output = await write(tx);
    await tx
      .update(analysisRuns)
      .set({ status: "succeeded", finishedAt: new Date(), output: output ?? null, errorKind: null, errorMessage: null })
      .where(eq(analysisRuns.id, runId));
  });
}

async function writeAbstraction(tx: Tx, run: Run, input: RunInput, value: Extract<ReturnType<typeof parseAbstraction>, { ok: true }>["value"]) {
  const registry = registryFor(run.productId, input.evidence ?? []);
  const requests = input.requests ?? [];
  for (const [position, draft] of value.claims.entries()) {
    const refs = [...new Map(draft.evidence.map((e) => [e.handle, e])).values()];
    const validities: EvidenceValidity[] = [];
    const evidenceIds: string[] = [];
    for (const ref of refs) {
      const candidate = candidateFor(input.evidence ?? [], registry.get(ref.handle)!.evidenceId)!;
      const { evidence, validity } = await ensureEvidence(tx, run.productId, candidate.versionId, candidate.start, candidate.end);
      if (!evidenceIds.includes(evidence.id)) evidenceIds.push(evidence.id);
      validities.push(validity);
    }
    const id = newId("cl");
    await tx.insert(claims).values({
      id,
      productId: run.productId,
      runId: run.id,
      position,
      section: draft.section,
      kind: draft.kind,
      origin: "model",
      text: draft.text,
      reasoning: draft.reasoning ?? null,
      missing: draft.missing ?? null,
      requestIds: (draft.requestHandles ?? []).flatMap((h) => requests.find((r) => r.handle === h)?.requestId ?? []),
      evidenceValidity: claimEvidenceValidity(validities),
    });
    if (evidenceIds.length) {
      await tx.insert(claimEvidences).values(evidenceIds.map((evidenceId, i) => ({ productId: run.productId, claimId: id, evidenceId, position: i })));
    }
  }
  await tx.update(analyses).set({ status: "pending_review", updatedAt: new Date() }).where(eq(analyses.id, run.analysisId));
  return {
    coverage: value.coverage.map(({ requestHandle, evidence: _e, ...row }) => ({ ...row, requestId: requests.find((r) => r.handle === requestHandle)!.requestId })),
  };
}

interface Task<T> {
  request: Omit<ModelRequest, "signal">;
  parse: (text: string) => ParseResult<T>;
  write: (tx: Tx, value: T) => Promise<unknown>;
}

// The value type is private to each task: parse produces what write consumes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function taskFor(deps: WorkerDeps, run: Run): Promise<Task<any>> {
  const input = run.inputSnapshot as RunInput;
  const { db, dataDir } = deps;
  if (run.taskType === "abstraction") {
    const requests = input.requests ?? [];
    const registry = registryFor(run.productId, input.evidence ?? []);
    return {
      request: {
        system: ABSTRACTION_SYSTEM,
        text: abstractionPrompt({ goal: input.goal ?? "", requests, registry }),
        schema: ABSTRACTION_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "abstraction",
      },
      parse: (text) => parseAbstraction(text, { productId: run.productId, requests, registry }),
      write: (tx, value) => writeAbstraction(tx, run, input, value as Parameters<typeof writeAbstraction>[3]),
    };
  }
  if (run.taskType === "split_requests") {
    return {
      request: { system: SPLIT_SYSTEM, text: splitPrompt(input.text ?? ""), schema: SPLIT_SCHEMA as unknown as Record<string, unknown>, schemaName: "split_requests" },
      parse: (text) => parseSplit(text, input.text ?? ""),
      write: async (_tx, value) => value,
    };
  }
  if (run.taskType === "transcribe_image") {
    const image = await readImage(db, dataDir, run.productId, input.imageVersionId!);
    return {
      request: {
        system: TRANSCRIBE_SYSTEM,
        text: TRANSCRIBE_PROMPT,
        images: [{ mediaType: image.mediaType, base64: Buffer.from(image.bytes).toString("base64") }],
        schema: TRANSCRIBE_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "transcript",
      },
      parse: parseTranscript,
      write: async (tx, value: { transcript: string }) => {
        const scoped = tx as unknown as Db;
        const saved = await saveTranscript(scoped, run.productId, input.imageVersionId!, value.transcript, "model");
        await appendToScope(scoped, run.productId, run.analysisId, { sourceVersionIds: [saved.versionId] });
        return saved;
      },
    };
  }
  throw new AppError("invalid_input", `未知的任务类型 ${run.taskType}`);
}

async function execute(deps: WorkerDeps, run: Run) {
  const { db, dataDir } = deps;
  const call = deps.call ?? callModel;
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    void db
      .update(analysisRuns)
      .set({ heartbeatAt: new Date() })
      .where(and(eq(analysisRuns.id, run.id), eq(analysisRuns.status, "running")))
      .returning({ id: analysisRuns.id })
      .then((rows) => {
        if (!rows.length) controller.abort();
      })
      .catch(() => undefined);
  }, deps.heartbeatMs ?? Math.min(2_000, HEARTBEAT_STALE_MS / 4));

  try {
    const endpoint = await resolveModelEndpoint(db, dataDir);
    const task = await taskFor(deps, run);
    for (let attempt = 1; ; attempt++) {
      await db.update(analysisRuns).set({ attempts: attempt }).where(eq(analysisRuns.id, run.id));
      const started = Date.now();
      const record = (usage: { model?: string; inputTokens?: number; outputTokens?: number }) =>
        db.insert(usageRecords).values({
          id: newId("use"),
          runId: run.id,
          provider: endpoint.adapter,
          model: usage.model ?? endpoint.model,
          attempt,
          durationMs: Date.now() - started,
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          estimatedCost: estimateCost(usage, endpoint.pricing)?.toString() ?? null,
        });

      let failure: { kind: ModelErrorKind; message: string };
      try {
        const response = await call(endpoint, { ...task.request, signal: controller.signal });
        await record(response);
        const parsed = task.parse(response.text);
        if (parsed.ok) {
          await finishSucceeded(db, run.id, (tx) => task.write(tx, parsed.value));
          return;
        }
        failure = { kind: "invalid_output", message: `模型输出未通过校验：${parsed.errors.slice(0, 3).join("；")}` };
      } catch (err) {
        if (!(err instanceof ModelError)) throw err;
        await record({});
        failure = { kind: err.kind, message: err.message };
      }
      if (failure.kind === "canceled") return;
      if (!shouldAutoRetry(failure.kind, attempt)) {
        await finishFailed(db, run.id, failure.kind, failure.message);
        return;
      }
    }
  } catch (err) {
    const message = err instanceof AppError ? err.message : "任务执行时发生内部错误";
    if (!(err instanceof AppError)) console.error("[pew] run failed:", err instanceof Error ? err.name : "unknown");
    await finishFailed(db, run.id, err instanceof AppError ? err.code : "internal", message);
  } finally {
    clearInterval(heartbeat);
  }
}

/** Process one queued run. Returns false when there was nothing to do. */
export async function processNextRun(deps: WorkerDeps): Promise<boolean> {
  const run = await claimNext(deps.db);
  if (!run) return false;
  await execute(deps, run);
  return true;
}

export function startWorker(deps: WorkerDeps & { pollMs?: number; exclusive?: boolean }) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      await recoverInterruptedRuns(deps.db);
      while (!stopped && (await processNextRun(deps)));
    } catch (err) {
      console.error("[pew] worker error:", err instanceof Error ? err.message : "unknown");
    }
    if (!stopped) timer = setTimeout(tick, deps.pollMs ?? 1_000);
  };
  void (async () => {
    // A single-process instance knows every running row belongs to a dead process.
    if (deps.exclusive) await recoverInterruptedRuns(deps.db, { all: true }).catch(() => undefined);
    await tick();
  })();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
