import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReportMarkdown } from "@pew/core";
import { strToU8, unzipSync, zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addEvidenceByQuote,
  addSource,
  addSourceVersion,
  addUserClaim,
  AppError,
  completeSetup,
  createAnalysis,
  createProduct,
  createRequests,
  deleteProduct,
  deleteSourcePermanently,
  exportProduct,
  getReportVersion,
  importProductArchive,
  inspectProductArchive,
  issueSetupCode,
  listClaims,
  listRequests,
  listSources,
  loadExample,
  login,
  openDb,
  reviewClaimById,
  saveReportVersion,
  setAnalysisScope,
  updateRequestFields,
  validateSession,
  type Db,
} from "@pew/db";

const MIGRATIONS = join(import.meta.dirname, "../../../migrations");
let db: Db;
let dataDir: string;

beforeEach(async () => {
  const handle = await openDb("pglite:memory");
  await handle.migrate(MIGRATIONS);
  db = handle.db;
  dataDir = mkdtempSync(join(tmpdir(), "pew-test-"));
});

const code = async (c: Promise<unknown>) => {
  try {
    await c;
  } catch (err) {
    return err instanceof AppError ? err.code : String(err);
  }
  return "ok";
};

describe("access", () => {
  it("setup code works once, then the passphrase logs in", async () => {
    const { code: setup } = await issueSetupCode(dataDir);
    const first = await completeSetup(db, dataDir, setup.toLowerCase(), "correct horse battery");
    expect(await validateSession(db, dataDir, first)).toBe(true);
    expect(await code(completeSetup(db, dataDir, setup, "another passphrase"))).toBe("unauthorized");
    expect(await code(login(db, "wrong passphrase"))).toBe("unauthorized");
    expect(await validateSession(db, dataDir, await login(db, "correct horse battery"))).toBe(true);
  });

  it("issuing a reset code invalidates existing sessions immediately", async () => {
    const session = await completeSetup(db, dataDir, (await issueSetupCode(dataDir)).code, "correct horse battery");
    await new Promise((r) => setTimeout(r, 5));
    const { code: reset } = await issueSetupCode(dataDir);
    expect(await validateSession(db, dataDir, session)).toBe(false);
    const fresh = await completeSetup(db, dataDir, reset, "brand new passphrase");
    expect(await validateSession(db, dataDir, fresh)).toBe(true);
    expect(await validateSession(db, dataDir, session)).toBe(false);
    expect(await code(login(db, "correct horse battery"))).toBe("unauthorized");
  });

  it("rejects expired codes and short passphrases", async () => {
    const { code: c } = await issueSetupCode(dataDir, new Date(Date.now() - 60 * 60_000));
    expect(await code(completeSetup(db, dataDir, c, "long enough passphrase"))).toBe("unauthorized");
    const { code: c2 } = await issueSetupCode(dataDir);
    expect(await code(completeSetup(db, dataDir, c2, "short"))).toBe("invalid_input");
  });
});

describe("sources and evidence", () => {
  it("reuses identical content and versions changed content", async () => {
    const p = await createProduct(db, { name: "P" });
    const a = await addSource(db, p.id, { name: "规则", text: "仅本人可见。\n" });
    expect(a.status).toBe("created");
    expect((await addSource(db, p.id, { name: "规则副本", text: "仅本人可见。\r\n" })).status).toBe("duplicate");
    expect((await addSourceVersion(db, p.id, a.sourceId, "仅本人可见。\n")).status).toBe("unchanged");
    const v2 = await addSourceVersion(db, p.id, a.sourceId, "团队可见。\n");
    expect(v2.status).toBe("created");
    expect((await listSources(db, p.id))[0]).toMatchObject({ version: 2, versionCount: 2 });
  });

  it("refuses unknown or ambiguous quotes and stale versions", async () => {
    const p = await createProduct(db, { name: "P" });
    const a = await addSource(db, p.id, { name: "规则", text: "导出。导出。仅本人。" });
    expect(await code(addEvidenceByQuote(db, p.id, a.versionId, "不存在"))).toBe("not_found");
    expect(await code(addEvidenceByQuote(db, p.id, a.versionId, "导出。"))).toBe("ambiguous");
    const ev = await addEvidenceByQuote(db, p.id, a.versionId, "仅本人");
    expect(ev).toMatchObject({ charStart: 6, charEnd: 9, lineStart: 1 });
    expect((await addEvidenceByQuote(db, p.id, a.versionId, "仅本人")).id).toBe(ev.id);
    await addSourceVersion(db, p.id, a.sourceId, "新版本");
    expect(await code(addEvidenceByQuote(db, p.id, a.versionId, "仅本人"))).toBe("invalid_input");
  });

  it("cannot cite another product's source version", async () => {
    const p1 = await createProduct(db, { name: "P1" });
    const p2 = await createProduct(db, { name: "P2" });
    const a = await addSource(db, p2.id, { name: "规则", text: "仅本人。" });
    expect(await code(addEvidenceByQuote(db, p1.id, a.versionId, "仅本人"))).toBe("not_found");
    const analysis = await createAnalysis(db, p1.id, { title: "A" });
    expect(await code(setAnalysisScope(db, p1.id, analysis.id, 0, { requestIds: [], sourceVersionIds: [a.versionId] }))).toBe("not_found");
  });
});

describe("requests", () => {
  it("a retried batch creates nothing new", async () => {
    const p = await createProduct(db, { name: "P" });
    const items = [{ party: "运营", originalText: "导出筛选结果。" }, { party: "客服", originalText: "导出工单客户，不含手机号。" }];
    const first = await createRequests(db, p.id, "batch-1", items);
    const again = await createRequests(db, p.id, "batch-1", items);
    expect(again).toEqual(first);
    expect(await listRequests(db, p.id)).toHaveLength(2);
  });

  it("detects stale edits from a second tab", async () => {
    const p = await createProduct(db, { name: "P" });
    const [id] = await createRequests(db, p.id, "b", [{ party: "运营", originalText: "导出。" }]);
    await updateRequestFields(db, p.id, id!, 0, { party: "运营", fields: { title: "导出" } });
    expect(await code(updateRequestFields(db, p.id, id!, 0, { party: "销售", fields: {} }))).toBe("conflict");
  });
});

describe("claims, reports and deletion", () => {
  async function setup() {
    const p = await createProduct(db, { name: "P" });
    const src = await addSource(db, p.id, { name: "数据说明", text: "# 字段\n\n手机号属于受限字段。\n" });
    const ev = await addEvidenceByQuote(db, p.id, src.versionId, "手机号属于受限字段。");
    const [req] = await createRequests(db, p.id, "b", [{ party: "客服", originalText: "导出工单客户，不含手机号。" }]);
    const a = await createAnalysis(db, p.id, { title: "导出", goal: "统一导出" });
    await setAnalysisScope(db, p.id, a.id, 0, { requestIds: [req!], sourceVersionIds: [src.versionId] });
    return { p, src, ev, a };
  }

  it("validates user claims like model output", async () => {
    const { p, a, ev } = await setup();
    expect(await code(addUserClaim(db, p.id, a.id, { section: "risk", kind: "source_fact", text: "无依据", evidenceIds: [] }))).toBe("invalid_input");
    expect(await code(addUserClaim(db, p.id, a.id, { section: "risk", kind: "unknown", text: "容量未知", evidenceIds: [] }))).toBe("invalid_input");
    await addUserClaim(db, p.id, a.id, { section: "conflict", kind: "source_fact", text: "客服导出不得包含手机号", evidenceIds: [ev.id] });
    const [claim] = await listClaims(db, p.id, a.id);
    expect(claim).toMatchObject({ origin: "user", review: "accepted", evidenceIds: [ev.id] });
  });

  it("saves immutable report versions and keeps the AI original on correction", async () => {
    const { p, a, ev } = await setup();
    await addUserClaim(db, p.id, a.id, { section: "conflict", kind: "source_fact", text: "客服导出不得包含手机号", evidenceIds: [ev.id] });
    const [claim] = await listClaims(db, p.id, a.id);
    await reviewClaimById(db, p.id, claim!.id, { type: "correct", text: "客服导出必须排除手机号" }, claim!.revision);
    expect(await code(reviewClaimById(db, p.id, claim!.id, { type: "accept" }, claim!.revision))).toBe("conflict");
    const v1 = await saveReportVersion(db, p.id, a.id);
    expect(v1).toMatchObject({ version: 1, status: "reviewed_clear" });
    const { snapshot } = await getReportVersion(db, p.id, a.id, 1);
    const md = renderReportMarkdown(snapshot);
    expect(md).toContain("**[原文事实 · 用户输入 · 已修正]** 客服导出必须排除手机号 — 依据 [E1]");
    expect(md).toContain("数据说明 v1 L3：“手机号属于受限字段。”");
    expect((await listClaims(db, p.id, a.id))[0]!.original?.text).toBe("客服导出不得包含手机号");
  });

  it("a new source version flags claims; permanent deletion scrubs saved reports", async () => {
    const { p, a, ev, src } = await setup();
    await addUserClaim(db, p.id, a.id, { section: "conflict", kind: "source_fact", text: "客服导出必须排除手机号", evidenceIds: [ev.id] });
    await saveReportVersion(db, p.id, a.id);
    await addSourceVersion(db, p.id, src.sourceId, "# 字段\n\n手机号属于受限字段，需脱敏。\n");
    expect((await listClaims(db, p.id, a.id))[0]!.evidenceValidity).toBe("needs_review");

    await deleteSourcePermanently(db, p.id, src.sourceId);
    expect((await listClaims(db, p.id, a.id))[0]!.evidenceValidity).toBe("source_deleted");
    const { snapshot } = await getReportVersion(db, p.id, a.id, 1);
    const md = renderReportMarkdown(snapshot);
    expect(JSON.stringify(snapshot)).not.toContain("手机号属于受限字段");
    expect(md).toContain("［来源已删除，原句不再保留］");
    expect(md).toContain("数据说明 v1（来源已删除）");
  });
});

describe("example, export and import", () => {
  it("loads the example once and clears it without typing the name", async () => {
    const id = await loadExample(db);
    expect(await loadExample(db)).toBe(id);
    expect(await listRequests(db, id)).toHaveLength(3);
    await deleteProduct(db, id, "");
    expect(await loadExample(db)).not.toBe(id);
  });

  it("round-trips a product with the same counts, text hashes and citations", async () => {
    const id = await loadExample(db);
    const [analysis] = await (await import("@pew/db")).listAnalyses(db, id);
    const claims = await listClaims(db, id, analysis!.id);
    for (const c of claims) await reviewClaimById(db, id, c.id, { type: "accept" }, c.revision);
    await saveReportVersion(db, id, analysis!.id);

    const { bytes } = await exportProduct(db, id);
    const files = Object.keys(unzipSync(bytes));
    expect(files).toContain("manifest.json");
    expect(files.some((f) => f.startsWith("texts/"))).toBe(true);
    expect(files.some((f) => f.startsWith("reports/"))).toBe(true);

    const { productId, summary } = await importProductArchive(db, bytes);
    expect(productId).not.toBe(id);
    expect(summary.counts).toMatchObject({ requests: 3, claims: 5, report_versions: 1, system_edges: 3 });
    const again = await exportProduct(db, productId);
    const before = inspectProductArchive(bytes);
    const after = inspectProductArchive(again.bytes);
    expect(after.summary.counts).toEqual(before.summary.counts);
    expect([...after.texts.values()].sort()).toEqual([...before.texts.values()].sort());
    const quotes = (p: typeof before) => p.tables.evidences.map((e) => `${e.charStart}-${e.charEnd}:${e.quote}`).sort();
    expect(quotes(after)).toEqual(quotes(before));
    // No ids from the original product survive in the copy.
    expect(JSON.stringify(after.tables)).not.toContain(id);
  });

  it("rejects path traversal, tampering and unknown schema versions", async () => {
    const id = await loadExample(db);
    const { bytes } = await exportProduct(db, id);
    const entries = unzipSync(bytes);

    const traversal = zipSync({ ...entries, "../evil.txt": strToU8("x") });
    expect(() => inspectProductArchive(traversal)).toThrow(/不允许的路径/);

    const textPath = Object.keys(entries).find((f) => f.startsWith("texts/"))!;
    const tampered = zipSync({ ...entries, [textPath]: strToU8("篡改后的内容") });
    expect(() => inspectProductArchive(tampered)).toThrow(/校验和不一致/);

    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
    const future = zipSync({ ...entries, "manifest.json": strToU8(JSON.stringify({ ...manifest, schemaVersion: 99 })) });
    expect(() => inspectProductArchive(future)).toThrow(/不支持的导出格式版本 99/);

    expect(() => inspectProductArchive(strToU8("not a zip"))).toThrow(/无法读取/);
  });
});
