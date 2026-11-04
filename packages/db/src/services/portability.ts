// Product export / import (PRD F09, §8.2).
//
// Layout: manifest.json (format, schema version, counts, sha256 per file),
// data/<table>.json, texts/<sourceVersionId>.txt, files/<sourceVersionId>.<ext>
// (screenshots), reports/<analysis>-v<n>.md.
// Source text lives only in texts/, and import checks it against the stored
// content hash. Import always creates a new product with fresh ids; it never
// overwrites an existing one. No keys, sessions or instance data are exported.

import { renderReportMarkdown, sha256, type ReportSnapshot } from "@pew/core";
import { readFileSync } from "node:fs";
import { eq, getTableColumns, type InferSelectModel } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Db } from "../client";
import { AppError, newId } from "../errors";
import * as s from "../schema";
import { removeStoredFile, sha256Bytes, sniffImage, storagePath, writeStoredFile } from "./media";
import { getProduct } from "./products";

export const EXPORT_FORMAT = "pew-product-export";
export const EXPORT_SCHEMA_VERSION = 1;
export const LIMITS = { zipBytes: 100 * 1024 * 1024, unzippedBytes: 200 * 1024 * 1024, files: 2_000 };

/** Insert order respects foreign keys. Every table here has a product_id column. */
const TABLES = {
  sources: s.sources,
  source_versions: s.sourceVersions,
  evidences: s.evidences,
  requests: s.requests,
  analyses: s.analyses,
  analysis_requests: s.analysisRequests,
  analysis_sources: s.analysisSources,
  system_nodes: s.systemNodes,
  system_edges: s.systemEdges,
  edge_evidences: s.edgeEvidences,
  rules: s.rules,
  decisions: s.decisions,
  analysis_runs: s.analysisRuns,
  claims: s.claims,
  claim_evidences: s.claimEvidences,
  report_versions: s.reportVersions,
} as const;
type TableName = keyof typeof TABLES;
type Row = Record<string, unknown>;

interface Manifest {
  format: string;
  schemaVersion: number;
  exportedAt: string;
  product: { id: string; name: string };
  counts: Record<string, number>;
  files: Record<string, string>;
}

function productColumn(table: PgTable) {
  return (getTableColumns(table) as Record<string, ReturnType<typeof getTableColumns>[string]>).productId!;
}

export async function exportProduct(db: Db, dataDir: string, productId: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const product = await getProduct(db, productId);
  const files: Record<string, Uint8Array> = {};
  const counts: Record<string, number> = {};

  for (const [name, table] of Object.entries(TABLES) as [TableName, PgTable][]) {
    let rows = (await db.select().from(table).where(eq(productColumn(table), productId))) as Row[];
    if (name === "source_versions") {
      rows = rows.map((r) => {
        if (typeof r.text === "string") files[`texts/${r.id}.txt`] = strToU8(r.text);
        if (typeof r.storageKey === "string") {
          const ext = r.storageKey.split(".").pop();
          files[`files/${r.id}.${ext}`] = new Uint8Array(readFileSync(storagePath(dataDir, r.storageKey)));
        }
        return { ...r, text: undefined, storageKey: undefined };
      });
    }
    if (name === "report_versions") {
      for (const r of rows) {
        files[`reports/${r.analysisId}-v${r.version}.md`] = strToU8(renderReportMarkdown(r.snapshot as ReportSnapshot));
      }
    }
    counts[name] = rows.length;
    files[`data/${name}.json`] = strToU8(JSON.stringify(rows, null, 1));
  }
  files["data/product.json"] = strToU8(JSON.stringify(product, null, 1));

  const manifest: Manifest = {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    product: { id: product.id, name: product.name },
    counts,
    files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, sha256Bytes(bytes)])),
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 1));
  const safeName = product.name.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "product";
  return { filename: `${safeName}-${manifest.exportedAt.slice(0, 10)}.pew.zip`, bytes: zipSync(files, { level: 6 }) };
}

const ALLOWED_PATH = /^(manifest\.json|data\/[a-z_]+\.json|texts\/[A-Za-z0-9_]+\.txt|files\/[A-Za-z0-9_]+\.(png|jpg|webp|gif)|reports\/[A-Za-z0-9_]+-v\d+\.md)$/;

const reject = (message: string, details: Record<string, unknown> = {}) => new AppError("import_rejected", message, details);

export interface ArchiveSummary {
  productName: string;
  exportedAt: string;
  counts: Record<string, number>;
}

interface ParsedArchive {
  summary: ArchiveSummary;
  product: Row;
  tables: Record<TableName, Row[]>;
  texts: Map<string, string>;
  images: Map<string, Uint8Array>;
}

/** Validates the archive completely without touching the database. */
export function inspectProductArchive(zip: Uint8Array): ParsedArchive {
  if (zip.byteLength > LIMITS.zipBytes) throw reject("导入包超过 100 MB");
  let fileCount = 0;
  let declared = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter(file) {
        fileCount++;
        declared += file.originalSize;
        if (fileCount > LIMITS.files) throw reject("导入包文件数超过 2,000");
        if (declared > LIMITS.unzippedBytes) throw reject("导入包解压后超过 200 MB");
        if (!ALLOWED_PATH.test(file.name)) throw reject("导入包含有不允许的路径", { path: file.name.slice(0, 200) });
        return true;
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw reject("无法读取 ZIP 文件");
  }
  const actual = Object.values(entries).reduce((n, b) => n + b.byteLength, 0);
  if (actual > LIMITS.unzippedBytes) throw reject("导入包解压后超过 200 MB");

  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw reject("缺少 manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as Manifest;
  } catch {
    throw reject("manifest.json 不是有效的 JSON");
  }
  if (manifest.format !== EXPORT_FORMAT) throw reject("不是本工具导出的产品包");
  if (manifest.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw reject(`不支持的导出格式版本 ${manifest.schemaVersion}，当前支持 ${EXPORT_SCHEMA_VERSION}`);
  }
  const listed = new Set(Object.keys(manifest.files ?? {}));
  for (const path of Object.keys(entries)) {
    if (path === "manifest.json") continue;
    if (!listed.has(path)) throw reject("导入包含有清单外的文件", { path });
    if (sha256Bytes(entries[path]!) !== manifest.files[path]) throw reject("文件校验和不一致", { path });
  }
  for (const path of listed) if (!entries[path]) throw reject("清单中的文件缺失", { path });

  const json = (path: string) => {
    try {
      return JSON.parse(strFromU8(entries[path]!)) as unknown;
    } catch {
      throw reject("数据文件不是有效的 JSON", { path });
    }
  };
  const product = json("data/product.json") as Row;
  const productId = product.id;
  const tables = {} as Record<TableName, Row[]>;
  for (const name of Object.keys(TABLES) as TableName[]) {
    const path = `data/${name}.json`;
    const rows = entries[path] ? json(path) : [];
    if (!Array.isArray(rows)) throw reject("数据文件格式错误", { path });
    if (rows.some((r) => (r as Row).productId !== productId)) throw reject("数据中混有其他产品的记录", { table: name });
    tables[name] = rows as Row[];
  }
  const texts = new Map<string, string>();
  const images = new Map<string, Uint8Array>();
  for (const v of tables.source_versions) {
    if (v.validity === "source_deleted") continue;
    if (typeof v.mediaType === "string") {
      const path = Object.keys(entries).find((p) => p.startsWith(`files/${v.id}.`));
      const bytes = path ? entries[path] : undefined;
      if (!bytes) throw reject("缺少截图文件", { sourceVersionId: v.id });
      if (sniffImage(bytes) !== v.mediaType || sha256Bytes(bytes) !== v.contentHash) throw reject("截图与记录的类型或哈希不一致", { sourceVersionId: v.id });
      images.set(v.id as string, bytes);
      continue;
    }
    const bytes = entries[`texts/${v.id}.txt`];
    if (!bytes) throw reject("缺少资料原文", { sourceVersionId: v.id });
    const text = strFromU8(bytes);
    if (sha256(text) !== v.contentHash) throw reject("资料原文与内容哈希不一致", { sourceVersionId: v.id });
    texts.set(v.id as string, text);
  }
  return {
    summary: {
      productName: String(product.name ?? ""),
      exportedAt: manifest.exportedAt,
      counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    },
    product,
    tables,
    texts,
    images,
  };
}

const ID_PREFIX = /^([a-z]+)_[0-9a-f]{32}$/;

/** Every id in the archive gets a fresh id; any string equal to an old id is rewritten, including inside JSON. */
function remapper(parsed: ParsedArchive) {
  const ids = new Map<string, string>();
  const register = (old: unknown) => {
    if (typeof old !== "string" || ids.has(old)) return;
    ids.set(old, newId(ID_PREFIX.exec(old)?.[1] ?? "imp"));
  };
  register(parsed.product.id);
  for (const rows of Object.values(parsed.tables)) for (const r of rows) register(r.id);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return ids.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { ids, walk };
}

function reviveRow(table: PgTable, row: Row): Row {
  const out: Row = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (!(key in row)) continue;
    const v = row[key];
    out[key] = column.columnType === "PgTimestamp" && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

export async function importProductArchive(db: Db, dataDir: string, zip: Uint8Array): Promise<{ productId: string; summary: ArchiveSummary }> {
  const parsed = inspectProductArchive(zip);
  const { ids, walk } = remapper(parsed);
  const productId = ids.get(parsed.product.id as string)!;

  // Batch keys are free-form and may embed old ids; each batch gets a fresh key.
  const batchKeys = new Map<string, string>();
  // Screenshots are written first under their new ids and removed again if the insert fails.
  const storageKeys = new Map<string, string>();
  for (const [oldId, bytes] of parsed.images) {
    storageKeys.set(oldId, writeStoredFile(dataDir, productId, ids.get(oldId)!, sniffImage(bytes)!, bytes));
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(s.products).values({
        id: productId,
        name: `${String(parsed.product.name).slice(0, 100)}（导入）`,
        description: String(parsed.product.description ?? ""),
        isExample: false,
      });
      for (const [name, table] of Object.entries(TABLES) as [TableName, PgTable][]) {
        const rows = parsed.tables[name].map((raw) => {
          const row = walk(raw) as Row;
          if (name === "source_versions") {
            row.text = parsed.texts.get(raw.id as string) ?? null;
            row.storageKey = storageKeys.get(raw.id as string) ?? null;
          }
          if (name === "requests" && typeof raw.batchKey === "string") {
            if (!batchKeys.has(raw.batchKey)) batchKeys.set(raw.batchKey, `import:${crypto.randomUUID()}`);
            row.batchKey = batchKeys.get(raw.batchKey);
          }
          if (name === "analysis_runs") {
            // Idempotency keys are global; manual runs stay discoverable by their analysis.
            row.idempotencyKey = String(raw.idempotencyKey).startsWith("manual:") ? `manual:${row.analysisId}` : `import:${row.id}`;
            if (row.status === "queued" || row.status === "running") row.status = "interrupted";
          }
          return reviveRow(table, row);
        });
        for (let i = 0; i < rows.length; i += 500) {
          await tx.insert(table).values(rows.slice(i, i + 500) as InferSelectModel<typeof table>[]);
        }
      }
    });
  } catch (err) {
    for (const key of storageKeys.values()) removeStoredFile(dataDir, key);
    throw err;
  }
  return { productId, summary: parsed.summary };
}
