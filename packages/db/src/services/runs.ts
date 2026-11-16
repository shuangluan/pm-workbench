// Starting and controlling model runs (PRD §6.1, §7.2). A run freezes its
// inputs when it is created; later edits to the analysis do not change it.

import {
  abstractionPrompt,
  checkBudget,
  estimateCost,
  estimateRequestTokens,
  ABSTRACTION_SCHEMA,
  SPLIT_SCHEMA,
  EvidenceRegistry,
  sentenceSpans,
  ABSTRACTION_SYSTEM,
  SPLIT_SYSTEM,
  splitPrompt,
  TEMPLATE_VERSIONS,
  type BudgetResult,
  type TaskRequest,
} from "@pew/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { AppError, newId, notFound } from "../errors";
import { analysisRuns, sourceVersions, usageRecords } from "../schema";
import { getAnalysis } from "./analyses";
import { getModelConfig } from "./models";
import { listRequests } from "./requests";

export const MIN_ABSTRACTION_REQUESTS = 2;
export const MAX_ABSTRACTION_REQUESTS = 10;

export interface EvidenceCandidate {
  versionId: string;
  start: number;
  end: number;
  quote: string;
}

export interface RunRequest extends TaskRequest {
  requestId: string;
  versionId: string;
}

export interface RunInput {
  templateVersion: string;
  model: { configId: string; adapter: string; model: string; host: string };
  requestIds: string[];
  sourceVersionIds: string[];
  goal?: string;
  requests?: RunRequest[];
  evidence?: EvidenceCandidate[];
  text?: string;
  textVersionId?: string;
  imageVersionId?: string;
  scrubbed?: boolean;
}

const candidateId = (c: EvidenceCandidate) => `${c.versionId}:${c.start}:${c.end}`;

/** Handles are assigned deterministically, so the worker rebuilds the same registry from the frozen list. */
export function registryFor(productId: string, candidates: EvidenceCandidate[]): EvidenceRegistry {
  return new EvidenceRegistry(
    candidates.map((c) => ({
      evidence: {
        id: candidateId(c),
        productId,
        sourceVersionId: c.versionId,
        start: c.start,
        end: c.end,
        lineStart: 0,
        lineEnd: 0,
        quote: c.quote,
        hash: "",
      },
      validity: "valid",
    })),
  );
}

export function candidateFor(candidates: EvidenceCandidate[], evidenceId: string) {
  return candidates.find((c) => candidateId(c) === evidenceId);
}

function hostOf(endpoint: string) {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export interface AbstractionPreview {
  configured: boolean;
  modelName: string | null;
  host: string | null;
  requests: { handle: string; party: string; title: string }[];
  sources: { name: string; chars: number }[];
  /** Screenshots in scope without a transcript: they are not sent. */
  untranscribed: { name: string; versionId: string; sourceId: string }[];
  inputTokens: number;
  budget: BudgetResult | null;
  /** Lowest and highest estimated cost, or null when no prices are set. */
  cost: { min: number; max: number } | null;
  blockers: string[];
}

async function buildAbstraction(db: Db, productId: string, analysisId: string) {
  const analysis = await getAnalysis(db, productId, analysisId);
  const config = await getModelConfig(db);
  const reqs = await listRequests(db, productId, analysis.requestIds);
  const ordered = analysis.requestIds.map((id) => reqs.find((r) => r.id === id)!).filter(Boolean);

  const requests: RunRequest[] = ordered.map((r, i) => ({
    handle: `R${i + 1}`,
    requestId: r.id,
    versionId: r.originalVersionId,
    party: r.party,
    title: (r.fields as Record<string, string>).title ?? "",
    text: r.originalText ?? "",
  }));

  const textSources = analysis.selectedSources.filter((s) => s.kind !== "image" && s.validity !== "source_deleted");
  const versions = textSources.length
    ? await db.select({ id: sourceVersions.id, text: sourceVersions.text }).from(sourceVersions).where(inArray(sourceVersions.id, textSources.map((s) => s.versionId)))
    : [];
  const evidence: EvidenceCandidate[] = [];
  for (const v of versions) {
    if (v.text === null) continue;
    for (const span of sentenceSpans(v.text)) evidence.push({ versionId: v.id, ...span, quote: v.text.slice(span.start, span.end) });
  }
  // Each request's verbatim text is citable as a whole.
  for (const r of ordered) {
    if (r.originalText) evidence.push({ versionId: r.originalVersionId, start: r.charStart, end: r.charEnd, quote: r.originalText });
  }

  const prompt = abstractionPrompt({ goal: analysis.goal, requests, registry: registryFor(productId, evidence) });
  const inputTokens = estimateRequestTokens({ system: ABSTRACTION_SYSTEM, text: prompt, schema: ABSTRACTION_SCHEMA });
  return { analysis, config, requests, evidence, textSources, inputTokens };
}

export async function previewAbstraction(db: Db, productId: string, analysisId: string): Promise<AbstractionPreview> {
  const { analysis, config, requests, textSources, inputTokens } = await buildAbstraction(db, productId, analysisId);
  const images = analysis.selectedSources.filter((s) => s.kind === "image" && s.validity === "valid");
  const transcribed = new Set(
    (
      await db
        .select({ from: sourceVersions.derivedFromVersionId })
        .from(sourceVersions)
        .where(and(eq(sourceVersions.productId, productId), eq(sourceVersions.validity, "valid")))
    ).map((v) => v.from),
  );
  const budget = config ? checkBudget({ inputTokens, contextLimit: config.contextLimit, outputLimit: config.outputLimit }) : null;
  const inPrice = config?.inputPricePerMillion ? Number(config.inputPricePerMillion) : undefined;
  const outPrice = config?.outputPricePerMillion ? Number(config.outputPricePerMillion) : undefined;
  const pricing = { inputPerMillion: inPrice, outputPerMillion: outPrice };
  const min = estimateCost({ inputTokens, outputTokens: 0 }, pricing);
  const max = config ? estimateCost({ inputTokens, outputTokens: config.outputLimit }, pricing) : null;

  const blockers: string[] = [];
  if (!config?.hasKey) blockers.push("No model is configured");
  if (requests.length < MIN_ABSTRACTION_REQUESTS) blockers.push(`Choose at least ${MIN_ABSTRACTION_REQUESTS} requests for an abstraction`);
  if (requests.length > MAX_ABSTRACTION_REQUESTS) blockers.push(`At most ${MAX_ABSTRACTION_REQUESTS} requests at a time; narrow the scope`);
  if (budget && !budget.ok) blockers.push(`The input is about ${budget.overBy.toLocaleString("en-US")} tokens over the model's budget; select less material`);
  if (analysis.status === "archived") blockers.push("An archived analysis cannot run");

  return {
    configured: !!config?.hasKey,
    modelName: config?.model ?? null,
    host: config ? hostOf(config.endpoint) : null,
    requests: requests.map((r) => ({ handle: r.handle, party: r.party, title: r.title || r.text.slice(0, 30) })),
    sources: textSources.map((s) => ({ name: s.name, chars: s.charCount })),
    untranscribed: images.filter((i) => !transcribed.has(i.versionId)).map((i) => ({ name: i.name, versionId: i.versionId, sourceId: i.sourceId })),
    inputTokens,
    budget,
    cost: min !== null && max !== null ? { min, max } : null,
    blockers,
  };
}

async function enqueue(db: Db, productId: string, analysisId: string, taskType: "abstraction" | "split_requests" | "transcribe_image", key: string, input: RunInput, retryOf?: string) {
  if (!/^[0-9a-f-]{36}$/.test(key)) throw new AppError("invalid_input", "Missing idempotency key");
  const id = newId("run");
  const [row] = await db
    .insert(analysisRuns)
    .values({ id, productId, analysisId, taskType, status: "queued", idempotencyKey: key, inputSnapshot: input, retryOfRunId: retryOf ?? null })
    .onConflictDoNothing()
    .returning({ id: analysisRuns.id });
  if (row) return row.id;
  // Same user action sent twice: return the run it already created.
  const [existing] = await db.select({ id: analysisRuns.id }).from(analysisRuns).where(eq(analysisRuns.idempotencyKey, key));
  return existing!.id;
}

function modelRef(config: NonNullable<Awaited<ReturnType<typeof getModelConfig>>>) {
  return { configId: config.id, adapter: config.adapter, model: config.model, host: hostOf(config.endpoint) };
}

async function requireModel(db: Db) {
  const config = await getModelConfig(db);
  if (!config?.hasKey) throw new AppError("not_initialized", "Configure a model under Settings first");
  return config;
}

export async function startAbstraction(db: Db, productId: string, analysisId: string, key: string) {
  const preview = await previewAbstraction(db, productId, analysisId);
  if (preview.blockers.length) throw new AppError("invalid_input", preview.blockers[0]!);
  const { analysis, config, requests, evidence } = await buildAbstraction(db, productId, analysisId);
  return enqueue(db, productId, analysisId, "abstraction", key, {
    templateVersion: TEMPLATE_VERSIONS.abstraction,
    model: modelRef(config!),
    requestIds: analysis.requestIds,
    sourceVersionIds: analysis.selectedSources.map((s) => s.versionId),
    goal: analysis.goal,
    requests,
    evidence,
  });
}

export async function startTranscribe(db: Db, productId: string, analysisId: string, imageVersionId: string, key: string) {
  const config = await requireModel(db);
  const analysis = await getAnalysis(db, productId, analysisId);
  const [image] = await db
    .select({ id: sourceVersions.id, mediaType: sourceVersions.mediaType, validity: sourceVersions.validity })
    .from(sourceVersions)
    .where(and(eq(sourceVersions.productId, productId), eq(sourceVersions.id, imageVersionId)));
  if (!image?.mediaType) throw notFound("Screenshot");
  if (image.validity !== "valid") throw new AppError("invalid_input", "Only the current version of a screenshot can be read");
  return enqueue(db, productId, analysisId, "transcribe_image", key, {
    templateVersion: TEMPLATE_VERSIONS.transcribe_image,
    model: modelRef(config),
    requestIds: analysis.requestIds,
    sourceVersionIds: [imageVersionId],
    imageVersionId,
  });
}

export async function startSplit(db: Db, productId: string, analysisId: string, text: string, key: string, textVersionId?: string) {
  const config = await requireModel(db);
  await getAnalysis(db, productId, analysisId);
  const body = text.trim();
  if (!body) throw new AppError("invalid_input", "There is no text to split");
  if (body.length > 20_000) throw new AppError("invalid_input", "At most 20,000 characters at a time; split it into batches");
  const budget = checkBudget({ inputTokens: estimateRequestTokens({ system: SPLIT_SYSTEM, text: splitPrompt(body), schema: SPLIT_SCHEMA }), contextLimit: config.contextLimit, outputLimit: config.outputLimit });
  if (!budget.ok) throw new AppError("invalid_input", `The input is about ${budget.overBy.toLocaleString("en-US")} tokens over the model's budget`);
  return enqueue(db, productId, analysisId, "split_requests", key, {
    templateVersion: TEMPLATE_VERSIONS.split_requests,
    model: modelRef(config),
    requestIds: [],
    sourceVersionIds: textVersionId ? [textVersionId] : [],
    text: body,
    textVersionId,
  });
}

/** Queued runs stop at once. A running one is flagged; the worker aborts the call on its next check. */
export async function cancelRun(db: Db, productId: string, runId: string) {
  const updated = await db
    .update(analysisRuns)
    .set({ status: "canceled", finishedAt: new Date() })
    .where(and(eq(analysisRuns.productId, productId), eq(analysisRuns.id, runId), inArray(analysisRuns.status, ["queued", "running"])))
    .returning({ id: analysisRuns.id });
  if (!updated.length) throw new AppError("conflict", "The run has already finished");
}

/** A retry is a new run over the same frozen input, linked to the original. */
export async function retryRun(db: Db, productId: string, runId: string, key: string) {
  const [run] = await db.select().from(analysisRuns).where(and(eq(analysisRuns.productId, productId), eq(analysisRuns.id, runId)));
  if (!run) throw notFound("Run");
  if (!["failed", "interrupted", "canceled"].includes(run.status)) throw new AppError("conflict", "Only a finished run that did not succeed can be retried");
  const input = run.inputSnapshot as RunInput;
  if (input.scrubbed) throw new AppError("invalid_input", "Some sources of this run were deleted; start a new run instead");
  if (run.taskType !== "abstraction" && run.taskType !== "split_requests" && run.taskType !== "transcribe_image") throw new AppError("invalid_input", "This kind of run cannot be retried");
  return enqueue(db, productId, run.analysisId, run.taskType, key, input, run.id);
}

export interface RunView {
  id: string;
  taskType: string;
  status: string;
  errorKind: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: Date;
  finishedAt: Date | null;
  model: string | null;
  output: unknown;
  scope: Pick<RunInput, "requestIds" | "sourceVersionIds">;
  inputTokens: number | null;
  outputTokens: number | null;
}

export async function listRuns(db: Db, productId: string, analysisId: string, limit = 10): Promise<RunView[]> {
  const rows = await db
    .select()
    .from(analysisRuns)
    .where(and(eq(analysisRuns.productId, productId), eq(analysisRuns.analysisId, analysisId)))
    .orderBy(desc(analysisRuns.createdAt))
    .limit(limit);
  const model = rows.filter((r) => r.taskType !== "manual");
  const usage = model.length ? await db.select().from(usageRecords).where(inArray(usageRecords.runId, model.map((r) => r.id))) : [];
  return model.map((r) => {
    const own = usage.filter((u) => u.runId === r.id);
    // Any attempt with unknown usage makes the total unknown, never 0.
    const sum = (k: "inputTokens" | "outputTokens") => (own.length && own.every((u) => u[k] !== null) ? own.reduce((n, u) => n + u[k]!, 0) : null);
    return {
      id: r.id,
      taskType: r.taskType,
      status: r.status,
      errorKind: r.errorKind,
      errorMessage: r.errorMessage,
      attempts: r.attempts,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      model: (r.inputSnapshot as Partial<RunInput>).model?.model ?? null,
      output: r.output,
      scope: {
        requestIds: (r.inputSnapshot as Partial<RunInput>).requestIds ?? [],
        sourceVersionIds: (r.inputSnapshot as Partial<RunInput>).sourceVersionIds ?? [],
      },
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
    };
  });
}

/** True when the analysis scope changed after this run froze its input. */
export function runIsStale(input: Pick<RunInput, "requestIds" | "sourceVersionIds">, analysis: { requestIds: string[]; selectedSources: { versionId: string }[] }) {
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  return !same(input.requestIds, analysis.requestIds) || !same(input.sourceVersionIds, analysis.selectedSources.map((s) => s.versionId));
}
