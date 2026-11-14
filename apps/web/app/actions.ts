"use server";

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ingestBytes, MAX_FILE_BYTES, MAX_FILES_PER_UPLOAD, type ClaimKind, type ClaimSection, type RejectReason } from "@pew/core";
import {
  addEvidenceByQuote,
  addEvidenceBySpan,
  addImageSource,
  appendToScope,
  cancelRun,
  quickStart,
  removeModelKey,
  retryRun,
  saveModelConfig,
  startAbstraction,
  startSplit,
  startTranscribe,
  testModelConnection,
  saveTranscript,
  setChangeNodes,
  addSource,
  addSourceVersion,
  addUserClaim,
  AppError,
  completeSetup,
  correctRequestText,
  createAnalysis,
  createProduct,
  createRequests,
  deleteAnalysis,
  deleteProduct,
  deleteSourcePermanently,
  findDuplicateRequests,
  importProductArchive,
  inspectProductArchive,
  loadExample,
  login,
  logout,
  REQUEST_FIELDS,
  reviewClaimById,
  saveReportVersion,
  setAnalysisScope,
  setAnalysisStatus,
  updateAnalysis,
  updateRequestFields,
  SESSION_COOKIE,
  type RequestFields,
} from "@pew/db";
import { ModelError } from "@pew/model-adapters";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearSessionCookie, requireSession, setSessionCookie } from "@/lib/auth";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import type { FormState } from "@/lib/form-state";

const str = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};
const strs = (fd: FormData, name: string) => fd.getAll(name).filter((v): v is string => typeof v === "string");

function echo(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$") || /passphrase|code|apiKey/i.test(key)) continue;
    const all = strs(fd, key);
    out[key] = all.length > 1 ? all : (all[0] ?? "");
  }
  return out;
}

/**
 * Wraps an action: checks the session, maps AppError to a form message and
 * echoes the submitted values back. Redirects and unexpected errors propagate.
 */
function act(fn: (fd: FormData) => Promise<string | void>, { publicAction = false } = {}) {
  return async (prev: FormState, fd: FormData): Promise<FormState> => {
    if (!publicAction) await requireSession();
    try {
      const ok = await fn(fd);
      revalidatePath("/", "layout");
      return { seq: prev.seq + 1, ok: ok ?? undefined };
    } catch (err) {
      if (err instanceof AppError) return { seq: prev.seq + 1, error: err.message, values: echo(fd) };
      throw err;
    }
  };
}

// Access

export const setupAction = act(
  async (fd) => {
    const passphrase = str(fd, "passphrase");
    if (passphrase !== str(fd, "passphrase2")) throw new AppError("invalid_input", "The two passphrases do not match");
    const token = await completeSetup(await getDb(), config.dataDir, str(fd, "code"), passphrase);
    await setSessionCookie(token);
    redirect("/");
  },
  { publicAction: true },
);

export const loginAction = act(
  async (fd) => {
    const token = await login(await getDb(), str(fd, "passphrase"));
    await setSessionCookie(token);
    redirect("/");
  },
  { publicAction: true },
);

export async function logoutAction() {
  await logout(await getDb(), (await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  redirect("/login");
}

// Products

export const createProductAction = act(async (fd) => {
  const product = await createProduct(await getDb(), { name: str(fd, "name"), description: str(fd, "description") });
  redirect(`/p/${product.id}`);
});

export const loadExampleAction = act(async () => {
  const id = await loadExample(await getDb());
  redirect(`/p/${id}`);
});

export const deleteProductAction = act(async (fd) => {
  await deleteProduct(await getDb(), str(fd, "productId"), str(fd, "confirmName"));
  redirect("/");
});

// Sources

export const addSourcesAction = act(async (fd) => {
  const db = await getDb();
  const productId = str(fd, "productId");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const pasted = str(fd, "text");
  if (!files.length && !pasted.trim()) throw new AppError("invalid_input", "Paste some text or choose a file");
  if (files.length > MAX_FILES_PER_UPLOAD) throw new AppError("invalid_input", `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time`);

  const results: string[] = [];
  if (pasted.trim()) {
    const name = str(fd, "name").trim() || "Pasted source";
    const r = await addSource(db, productId, { name, text: pasted, kind: "paste", originalUrl: str(fd, "originalUrl") });
    results.push(r.status === "created" ? `"${name}" saved` : `"${name}" has the same content as "${r.name}" and was reused`);
  }
  for (const file of files) {
    const name = file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "Untitled file";
    if (!/\.(txt|md|markdown)$/i.test(name)) {
      results.push(`"${name}" failed: only .txt and .md are supported`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      results.push(`"${name}" failed: larger than 2 MB`);
      continue;
    }
    const ingested = ingestBytes(new Uint8Array(await file.arrayBuffer()));
    if (!ingested.ok) {
      const why = { empty: "the file is empty", too_large: "larger than 2 MB", invalid_encoding: "not UTF-8; convert it and upload again", too_many_chars: "more than 100,000 characters" }[ingested.code];
      results.push(`"${name}" failed: ${why}`);
      continue;
    }
    try {
      const r = await addSource(db, productId, { name, text: ingested.text, kind: "file" });
      results.push(r.status === "created" ? `"${name}" saved` : `"${name}" has the same content as "${r.name}" and was reused`);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      results.push(`"${name}" failed: ${err.message}`);
    }
  }
  return results.join("; ");
});

export const addSourceVersionAction = act(async (fd) => {
  const productId = str(fd, "productId");
  const sourceId = str(fd, "sourceId");
  const r = await addSourceVersion(await getDb(), productId, sourceId, str(fd, "text"));
  if (r.status === "unchanged") return "Same content as the current version; no new version created";
  redirect(`/p/${productId}/sources/${sourceId}`);
});

export const addEvidenceAction = act(async (fd) => {
  await addEvidenceByQuote(await getDb(), str(fd, "productId"), str(fd, "versionId"), str(fd, "quote"));
  return "Citation added";
});

export const deleteSourceAction = act(async (fd) => {
  if (str(fd, "confirm") !== "DELETE") throw new AppError("invalid_input", "Type DELETE to confirm");
  const productId = str(fd, "productId");
  await deleteSourcePermanently(await getDb(), productId, str(fd, "sourceId"), config.dataDir);
  redirect(`/p/${productId}`);
});

// Requests

function requestFields(fd: FormData): RequestFields {
  return Object.fromEntries(REQUEST_FIELDS.map((k) => [k, str(fd, k)]));
}

export const createRequestAction = act(async (fd) => {
  const db = await getDb();
  const productId = str(fd, "productId");
  const originalText = str(fd, "originalText");
  if (!strs(fd, "allowDuplicate").includes("yes")) {
    const dups = originalText.trim() ? await findDuplicateRequests(db, productId, originalText) : [];
    if (dups.length) {
      throw new AppError(
        "duplicate",
        `${dups.length === 1 ? "A request" : `${dups.length} requests`} with the same text already exist (${dups.map((d) => d.party).join(", ")}). If this is the same ask from a different party, tick the option below and save again.`,
      );
    }
  }
  await createRequests(db, productId, str(fd, "batchKey"), [
    {
      party: str(fd, "party"),
      sourceName: str(fd, "sourceName"),
      originalUrl: str(fd, "originalUrl"),
      originalText,
      fields: requestFields(fd),
    },
  ]);
  redirect(`/p/${productId}#requests`);
});

export const updateRequestAction = act(async (fd) => {
  await updateRequestFields(await getDb(), str(fd, "productId"), str(fd, "requestId"), Number(str(fd, "revision")), {
    party: str(fd, "party"),
    fields: requestFields(fd),
  });
  return "Saved";
});

export const correctRequestTextAction = act(async (fd) => {
  await correctRequestText(await getDb(), str(fd, "productId"), str(fd, "requestId"), Number(str(fd, "revision")), str(fd, "originalText"));
  return "Saved as a new version; citations of the old version are unchanged";
});

// Analyses

export const createAnalysisAction = act(async (fd) => {
  const productId = str(fd, "productId");
  const a = await createAnalysis(await getDb(), productId, {
    title: str(fd, "title"),
    goal: str(fd, "goal"),
    changeDescription: str(fd, "changeDescription"),
  });
  redirect(`/p/${productId}/a/${a.id}`);
});

export const updateAnalysisAction = act(async (fd) => {
  await updateAnalysis(await getDb(), str(fd, "productId"), str(fd, "analysisId"), Number(str(fd, "revision")), {
    title: str(fd, "title"),
    goal: str(fd, "goal"),
    changeDescription: str(fd, "changeDescription"),
  });
  return "Saved";
});

export const setScopeAction = act(async (fd) => {
  await setAnalysisScope(await getDb(), str(fd, "productId"), str(fd, "analysisId"), Number(str(fd, "revision")), {
    requestIds: strs(fd, "requestIds"),
    sourceVersionIds: strs(fd, "sourceVersionIds"),
  });
  return "Scope saved";
});

export const archiveAnalysisAction = act(async (fd) => {
  const to = str(fd, "to") === "archived" ? "archived" : "draft";
  await setAnalysisStatus(await getDb(), str(fd, "productId"), str(fd, "analysisId"), to);
});

export const deleteAnalysisAction = act(async (fd) => {
  if (str(fd, "confirm") !== "DELETE") throw new AppError("invalid_input", "Type DELETE to confirm");
  const productId = str(fd, "productId");
  await deleteAnalysis(await getDb(), productId, str(fd, "analysisId"));
  redirect(`/p/${productId}`);
});

// Claims

export const addClaimAction = act(async (fd) => {
  const db = await getDb();
  const productId = str(fd, "productId");
  const evidenceIds = strs(fd, "evidenceIds");
  const quote = str(fd, "newQuote");
  if (quote.trim()) {
    const versionId = str(fd, "newQuoteVersionId");
    if (!versionId) throw new AppError("invalid_input", "Choose which source the new citation comes from");
    evidenceIds.push((await addEvidenceByQuote(db, productId, versionId, quote)).id);
  }
  await addUserClaim(db, productId, str(fd, "analysisId"), {
    section: str(fd, "section") as ClaimSection,
    kind: str(fd, "kind") as ClaimKind,
    text: str(fd, "text"),
    reasoning: str(fd, "reasoning"),
    missing: str(fd, "missing"),
    evidenceIds,
  });
  return "Claim added";
});

export const reviewAction = act(async (fd) => {
  const type = str(fd, "type");
  const action =
    type === "accept"
      ? ({ type: "accept" } as const)
      : type === "reopen"
        ? ({ type: "reopen" } as const)
        : type === "correct"
          ? ({ type: "correct", text: str(fd, "text") } as const)
          : ({ type: "reject", reason: str(fd, "reason") as RejectReason, note: str(fd, "note") } as const);
  await reviewClaimById(await getDb(), str(fd, "productId"), str(fd, "claimId"), action, Number(str(fd, "revision")));
});

// Reports

export const saveReportAction = act(async (fd) => {
  const productId = str(fd, "productId");
  const analysisId = str(fd, "analysisId");
  const row = await saveReportVersion(await getDb(), productId, analysisId);
  redirect(`/p/${productId}/a/${analysisId}/reports/${row.version}`);
});

// Import (two steps: inspect, then confirm)

const importDir = () => join(config.dataDir, "imports");

export const inspectImportAction = act(async (fd) => {
  const file = fd.get("archive");
  if (!(file instanceof File) || file.size === 0) throw new AppError("invalid_input", "Choose an exported .zip file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  inspectProductArchive(bytes);
  const token = crypto.randomUUID();
  mkdirSync(importDir(), { recursive: true });
  writeFileSync(join(importDir(), `${token}.zip`), bytes, { mode: 0o600 });
  redirect(`/import?token=${token}`);
});

export const confirmImportAction = act(async (fd) => {
  const token = str(fd, "token");
  if (!/^[0-9a-f-]{36}$/.test(token)) throw new AppError("invalid_input", "Invalid import token");
  const path = join(importDir(), `${token}.zip`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(path));
  } catch {
    throw new AppError("not_found", "The file to import has expired; upload it again");
  }
  const { productId } = await importProductArchive(await getDb(), config.dataDir, bytes);
  rmSync(path, { force: true });
  redirect(`/p/${productId}`);
});

// Quick start and bulk entry

interface RequestPayload {
  party: string;
  title?: string;
  text: string;
}

function parseRequests(fd: FormData, sourceName: string): { party: string; originalText: string; sourceName: string; fields: RequestFields }[] {
  let raw: unknown;
  try {
    raw = JSON.parse(str(fd, "requests") || "[]");
  } catch {
    throw new AppError("invalid_input", "Request data is malformed; refresh and try again");
  }
  if (!Array.isArray(raw)) throw new AppError("invalid_input", "Request data is malformed");
  return (raw as RequestPayload[])
    .filter((r) => typeof r?.text === "string" && r.text.trim())
    .map((r) => ({
      party: String(r.party ?? ""),
      originalText: r.text,
      sourceName,
      fields: r.title ? { title: String(r.title) } : {},
    }));
}

async function readDocs(fd: FormData) {
  const out: { name: string; text: string; kind: "file" | "paste" }[] = [];
  const notes: string[] = [];
  const files = fd.getAll("docs").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_FILES_PER_UPLOAD) throw new AppError("invalid_input", `At most ${MAX_FILES_PER_UPLOAD} source files at a time`);
  for (const file of files) {
    const name = file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "Untitled file";
    if (!/\.(txt|md|markdown)$/i.test(name)) {
      notes.push(`"${name}" not saved: only .txt and .md are supported`);
      continue;
    }
    const ingested = ingestBytes(new Uint8Array(await file.arrayBuffer()));
    if (!ingested.ok) {
      notes.push(`"${name}" not saved: ${{ empty: "the file is empty", too_large: "larger than 2 MB", invalid_encoding: "not UTF-8; convert it and upload again", too_many_chars: "more than 100,000 characters" }[ingested.code]}`);
      continue;
    }
    out.push({ name, text: ingested.text, kind: "file" });
  }
  if (str(fd, "docText").trim()) out.push({ name: str(fd, "docName").trim() || "Pasted source", text: str(fd, "docText"), kind: "paste" });
  return { docs: out, notes };
}

async function readImages(fd: FormData) {
  return Promise.all(
    fd
      .getAll("images")
      .filter((f): f is File => f instanceof File && f.size > 0)
      .map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
}

export const quickStartAction = act(async (fd) => {
  const { docs } = await readDocs(fd);
  const today = new Date().toISOString().slice(0, 10);
  const r = await quickStart(await getDb(), config.dataDir, {
    batchKey: str(fd, "batchKey"),
    product: str(fd, "productId") ? { id: str(fd, "productId") } : { name: str(fd, "productName") },
    analysis: { title: str(fd, "title"), goal: str(fd, "goal") },
    requests: parseRequests(fd, `Quick start ${today}`),
    sources: docs,
    images: await readImages(fd),
  });
  redirect(`/p/${r.productId}/a/${r.analysisId}?step=claims&created=1`);
});

export const bulkCreateRequestsAction = act(async (fd) => {
  const db = await getDb();
  const productId = str(fd, "productId");
  const analysisId = str(fd, "analysisId");
  const requests = parseRequests(fd, str(fd, "sourceName") || `Bulk entry ${new Date().toISOString().slice(0, 10)}`);
  if (!requests.length) throw new AppError("invalid_input", "There are no requests to save");
  const missing = requests.findIndex((r) => !r.party.trim());
  if (missing !== -1) throw new AppError("invalid_input", `Request ${missing + 1} has no party`);
  const ids = await createRequests(db, productId, str(fd, "batchKey"), requests);
  if (analysisId) {
    await appendToScope(db, productId, analysisId, { requestIds: ids });
    redirect(`/p/${productId}/a/${analysisId}?step=scope`);
  }
  redirect(`/p/${productId}#requests`);
});

export const uploadImagesAction = act(async (fd) => {
  const db = await getDb();
  const productId = str(fd, "productId");
  const images = await readImages(fd);
  if (!images.length) throw new AppError("invalid_input", "Paste or choose a screenshot first");
  const notes: string[] = [];
  const versionIds: string[] = [];
  for (const img of images) {
    try {
      const r = await addImageSource(db, config.dataDir, productId, img);
      versionIds.push(r.versionId);
      notes.push(r.status === "created" ? `"${img.name}" saved` : `"${img.name}" is identical to "${r.name}" and was reused`);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      notes.push(`"${img.name}" not saved: ${err.message}`);
    }
  }
  const analysisId = str(fd, "analysisId");
  if (analysisId && versionIds.length) await appendToScope(db, productId, analysisId, { sourceVersionIds: versionIds });
  return notes.join("; ");
});

export const saveTranscriptAction = act(async (fd) => {
  const db = await getDb();
  const productId = str(fd, "productId");
  const r = await saveTranscript(db, productId, str(fd, "imageVersionId"), str(fd, "text"), "user");
  const analysisId = str(fd, "analysisId");
  if (analysisId) await appendToScope(db, productId, analysisId, { sourceVersionIds: [r.versionId] });
  return r.status === "unchanged" ? "No changes" : "Transcript saved. You can select citations in it, or split it into requests.";
});

export const setChangeNodesAction = act(async (fd) => {
  await setChangeNodes(await getDb(), str(fd, "productId"), str(fd, "analysisId"), strs(fd, "nodeIds"));
  return "Saved. The report's dependency check starts from these nodes.";
});

/** Called from the source viewer when the user selects text. Not a form action. */
export async function citeSelectionAction(input: { productId: string; versionId: string; start: number; end: number }): Promise<{ evidenceId?: string; error?: string }> {
  await requireSession();
  try {
    const ev = await addEvidenceBySpan(await getDb(), input.productId, input.versionId, input.start, input.end);
    revalidatePath("/", "layout");
    return { evidenceId: ev.id };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

// Model

export const saveModelAction = act(async (fd) => {
  await saveModelConfig(await getDb(), config.dataDir, {
    adapter: str(fd, "adapter") === "openai_compatible" ? "openai_compatible" : "anthropic_messages",
    endpoint: str(fd, "endpoint"),
    model: str(fd, "model"),
    apiKey: str(fd, "apiKey"),
    allowLocalHttp: strs(fd, "allowLocalHttp").includes("yes"),
    contextLimit: Number(str(fd, "contextLimit")),
    outputLimit: Number(str(fd, "outputLimit")),
    timeoutSeconds: Number(str(fd, "timeoutSeconds")),
    inputPricePerMillion: str(fd, "inputPricePerMillion"),
    outputPricePerMillion: str(fd, "outputPricePerMillion"),
  });
  return "Saved";
});

export const removeModelKeyAction = act(async () => {
  await removeModelKey(await getDb());
  return "Key removed";
});

const CONNECTION_HINTS: Record<string, string> = {
  auth: "Key rejected: check that the key is correct and allowed to use this model.",
  model_not_found: "Model not found: check the model ID and that your account can use it.",
  network: "Cannot connect: check the endpoint and your network.",
  rate_limited: "Rate limited or out of quota: try again later, or check your account.",
  unsupported_format: "Unsupported format: this model or service may not support structured output.",
  outcome_unknown: "Timed out: raise the timeout, or check your network.",
  truncated: "Output limit too low: raise it.",
  refused: "The model refused the test request.",
};

export const testModelAction = act(async () => {
  try {
    const { model } = await testModelConnection(await getDb(), config.dataDir);
    return `Connected. Model ${model} responded.`;
  } catch (err) {
    if (err instanceof ModelError) throw new AppError("invalid_input", CONNECTION_HINTS[err.kind] ?? err.message);
    throw err;
  }
});

// Runs

export const startAbstractionAction = act(async (fd) => {
  await startAbstraction(await getDb(), str(fd, "productId"), str(fd, "analysisId"), str(fd, "key"));
});

/** Per-image keys derive from the form's key, so resubmitting does not queue a second read. */
function derivedKey(base: string, part: string) {
  const h = createHash("sha256").update(`${base}:${part}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const startTranscribeAction = act(async (fd) => {
  const db = await getDb();
  for (const versionId of strs(fd, "imageVersionId")) {
    await startTranscribe(db, str(fd, "productId"), str(fd, "analysisId"), versionId, derivedKey(str(fd, "key"), versionId));
  }
});

export const cancelRunAction = act(async (fd) => {
  await cancelRun(await getDb(), str(fd, "productId"), str(fd, "runId"));
});

export const retryRunAction = act(async (fd) => {
  await retryRun(await getDb(), str(fd, "productId"), str(fd, "runId"), str(fd, "key"));
});

/** Called from the request importer. Not a form action. */
export async function startSplitAction(input: { productId: string; analysisId: string; text: string; key: string; textVersionId?: string }): Promise<{ runId?: string; error?: string }> {
  await requireSession();
  try {
    return { runId: await startSplit(await getDb(), input.productId, input.analysisId, input.text, input.key, input.textVersionId) };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}
