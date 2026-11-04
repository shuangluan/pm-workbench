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
    if (passphrase !== str(fd, "passphrase2")) throw new AppError("invalid_input", "两次输入的访问口令不一致");
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
  if (!files.length && !pasted.trim()) throw new AppError("invalid_input", "请粘贴文字或选择文件");
  if (files.length > MAX_FILES_PER_UPLOAD) throw new AppError("invalid_input", `一次最多上传 ${MAX_FILES_PER_UPLOAD} 个文件`);

  const results: string[] = [];
  if (pasted.trim()) {
    const name = str(fd, "name").trim() || "粘贴的资料";
    const r = await addSource(db, productId, { name, text: pasted, kind: "paste", originalUrl: str(fd, "originalUrl") });
    results.push(r.status === "created" ? `“${name}”已保存` : `“${name}”与已有资料“${r.name}”内容相同，已复用`);
  }
  for (const file of files) {
    const name = file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "未命名文件";
    if (!/\.(txt|md|markdown)$/i.test(name)) {
      results.push(`“${name}”失败：只支持 .txt / .md`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      results.push(`“${name}”失败：超过 2 MB`);
      continue;
    }
    const ingested = ingestBytes(new Uint8Array(await file.arrayBuffer()));
    if (!ingested.ok) {
      const why = { empty: "内容为空", too_large: "超过 2 MB", invalid_encoding: "不是 UTF-8 编码，请转换后再上传", too_many_chars: "超过 100,000 字符" }[ingested.code];
      results.push(`“${name}”失败：${why}`);
      continue;
    }
    try {
      const r = await addSource(db, productId, { name, text: ingested.text, kind: "file" });
      results.push(r.status === "created" ? `“${name}”已保存` : `“${name}”与已有资料“${r.name}”内容相同，已复用`);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      results.push(`“${name}”失败：${err.message}`);
    }
  }
  return results.join("；");
});

export const addSourceVersionAction = act(async (fd) => {
  const productId = str(fd, "productId");
  const sourceId = str(fd, "sourceId");
  const r = await addSourceVersion(await getDb(), productId, sourceId, str(fd, "text"));
  if (r.status === "unchanged") return "内容与当前版本相同，未创建新版本";
  redirect(`/p/${productId}/sources/${sourceId}`);
});

export const addEvidenceAction = act(async (fd) => {
  await addEvidenceByQuote(await getDb(), str(fd, "productId"), str(fd, "versionId"), str(fd, "quote"));
  return "引用已添加";
});

export const deleteSourceAction = act(async (fd) => {
  if (str(fd, "confirm") !== "永久删除") throw new AppError("invalid_input", "请输入“永久删除”以确认");
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
        `已有 ${dups.length} 条原文相同的需求（${dups.map((d) => d.party).join("、")}）。如果是不同提出者的同样诉求，勾选下方选项后再保存。`,
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
  return "已保存";
});

export const correctRequestTextAction = act(async (fd) => {
  await correctRequestText(await getDb(), str(fd, "productId"), str(fd, "requestId"), Number(str(fd, "revision")), str(fd, "originalText"));
  return "已保存为新版本，旧版本引用保持不变";
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
  return "已保存";
});

export const setScopeAction = act(async (fd) => {
  await setAnalysisScope(await getDb(), str(fd, "productId"), str(fd, "analysisId"), Number(str(fd, "revision")), {
    requestIds: strs(fd, "requestIds"),
    sourceVersionIds: strs(fd, "sourceVersionIds"),
  });
  return "范围已保存";
});

export const archiveAnalysisAction = act(async (fd) => {
  const to = str(fd, "to") === "archived" ? "archived" : "draft";
  await setAnalysisStatus(await getDb(), str(fd, "productId"), str(fd, "analysisId"), to);
});

export const deleteAnalysisAction = act(async (fd) => {
  if (str(fd, "confirm") !== "删除") throw new AppError("invalid_input", "请输入“删除”以确认");
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
    if (!versionId) throw new AppError("invalid_input", "请选择新引用来自哪份资料");
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
  return "条目已添加";
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
  if (!(file instanceof File) || file.size === 0) throw new AppError("invalid_input", "请选择导出的 .zip 文件");
  const bytes = new Uint8Array(await file.arrayBuffer());
  inspectProductArchive(bytes);
  const token = crypto.randomUUID();
  mkdirSync(importDir(), { recursive: true });
  writeFileSync(join(importDir(), `${token}.zip`), bytes, { mode: 0o600 });
  redirect(`/import?token=${token}`);
});

export const confirmImportAction = act(async (fd) => {
  const token = str(fd, "token");
  if (!/^[0-9a-f-]{36}$/.test(token)) throw new AppError("invalid_input", "导入令牌无效");
  const path = join(importDir(), `${token}.zip`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(path));
  } catch {
    throw new AppError("not_found", "待导入的文件已过期，请重新上传");
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
    throw new AppError("invalid_input", "需求数据格式错误，请刷新后重试");
  }
  if (!Array.isArray(raw)) throw new AppError("invalid_input", "需求数据格式错误");
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
  if (files.length > MAX_FILES_PER_UPLOAD) throw new AppError("invalid_input", `资料一次最多 ${MAX_FILES_PER_UPLOAD} 个文件`);
  for (const file of files) {
    const name = file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "未命名文件";
    if (!/\.(txt|md|markdown)$/i.test(name)) {
      notes.push(`“${name}”未保存：只支持 .txt / .md`);
      continue;
    }
    const ingested = ingestBytes(new Uint8Array(await file.arrayBuffer()));
    if (!ingested.ok) {
      notes.push(`“${name}”未保存：${{ empty: "内容为空", too_large: "超过 2 MB", invalid_encoding: "不是 UTF-8 编码", too_many_chars: "超过 100,000 字符" }[ingested.code]}`);
      continue;
    }
    out.push({ name, text: ingested.text, kind: "file" });
  }
  if (str(fd, "docText").trim()) out.push({ name: str(fd, "docName").trim() || "粘贴的资料", text: str(fd, "docText"), kind: "paste" });
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
    requests: parseRequests(fd, `快速开始 ${today}`),
    sources: docs,
    images: await readImages(fd),
  });
  redirect(`/p/${r.productId}/a/${r.analysisId}?step=claims&created=1`);
});

export const bulkCreateRequestsAction = act(async (fd) => {
  const db = await getDb();
  const productId = str(fd, "productId");
  const analysisId = str(fd, "analysisId");
  const requests = parseRequests(fd, str(fd, "sourceName") || `批量录入 ${new Date().toISOString().slice(0, 10)}`);
  if (!requests.length) throw new AppError("invalid_input", "没有可保存的需求");
  const missing = requests.findIndex((r) => !r.party.trim());
  if (missing !== -1) throw new AppError("invalid_input", `第 ${missing + 1} 条需求缺少业务方`);
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
  if (!images.length) throw new AppError("invalid_input", "请先粘贴或选择截图");
  const notes: string[] = [];
  const versionIds: string[] = [];
  for (const img of images) {
    try {
      const r = await addImageSource(db, config.dataDir, productId, img);
      versionIds.push(r.versionId);
      notes.push(r.status === "created" ? `“${img.name}”已保存` : `“${img.name}”与“${r.name}”相同，已复用`);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      notes.push(`“${img.name}”未保存：${err.message}`);
    }
  }
  const analysisId = str(fd, "analysisId");
  if (analysisId && versionIds.length) await appendToScope(db, productId, analysisId, { sourceVersionIds: versionIds });
  return notes.join("；");
});

export const saveTranscriptAction = act(async (fd) => {
  const db = await getDb();
  const productId = str(fd, "productId");
  const r = await saveTranscript(db, productId, str(fd, "imageVersionId"), str(fd, "text"), "user");
  const analysisId = str(fd, "analysisId");
  if (analysisId) await appendToScope(db, productId, analysisId, { sourceVersionIds: [r.versionId] });
  return r.status === "unchanged" ? "内容没有变化" : "转写已保存。可以在转写中划选引用，或从转写拆分需求。";
});

export const setChangeNodesAction = act(async (fd) => {
  await setChangeNodes(await getDb(), str(fd, "productId"), str(fd, "analysisId"), strs(fd, "nodeIds"));
  return "已保存，报告中的依赖检查将从这些节点开始";
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
  return "已保存";
});

export const removeModelKeyAction = act(async () => {
  await removeModelKey(await getDb());
  return "密钥已删除";
});

const CONNECTION_HINTS: Record<string, string> = {
  auth: "密钥错误：请检查密钥是否正确、是否有权限使用这个模型。",
  model_not_found: "模型不存在：请检查模型 ID，以及账号是否能使用它。",
  network: "连不上：请检查端点地址和网络。",
  rate_limited: "被限流或额度用完：请稍后再试，或检查账户额度。",
  unsupported_format: "格式不支持：这个模型或服务可能不支持结构化输出。",
  outcome_unknown: "连接超时：请调高超时，或检查网络。",
  truncated: "输出上限过低：请调高输出上限。",
  refused: "模型拒绝了测试请求。",
};

export const testModelAction = act(async () => {
  try {
    const { model } = await testModelConnection(await getDb(), config.dataDir);
    return `连接成功，模型 ${model} 已响应。`;
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
