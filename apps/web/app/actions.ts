"use server";

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ingestBytes, MAX_FILE_BYTES, MAX_FILES_PER_UPLOAD, type ClaimKind, type ClaimSection, type RejectReason } from "@pew/core";
import {
  addEvidenceByQuote,
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
    if (key.startsWith("$") || /passphrase|code/i.test(key)) continue;
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
  await deleteSourcePermanently(await getDb(), productId, str(fd, "sourceId"));
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
  const { productId } = await importProductArchive(await getDb(), bytes);
  rmSync(path, { force: true });
  redirect(`/p/${productId}`);
});
