// Requests (PRD F03). The verbatim text is stored as its own source version
// with one evidence span covering it, so it can be cited and versioned like
// any other material. Structured fields never overwrite it.

import { charCount, makeEvidence, MAX_REQUEST_PASTE_CHARS } from "@pew/core";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import type { Db, Tx } from "../client";
import { AppError, newId, notFound, revisionConflict } from "../errors";
import { evidences, requests, sourceVersions, sources } from "../schema";
import { touchProduct } from "./products";
import { ingestOrThrow, supersedeVersions } from "./sources";

export const REQUEST_FIELDS = ["title", "user", "goal", "scenario", "workaround", "constraints", "timing", "type", "questions"] as const;
export type RequestField = (typeof REQUEST_FIELDS)[number];
export type RequestFields = Partial<Record<RequestField, string>>;

export interface NewRequest {
  party: string;
  sourceName?: string;
  originalUrl?: string;
  originalText: string;
  fields?: RequestFields;
}

/** First line of the verbatim text without a leading "speaker：" label, for display names. */
function summaryLine(text: string): string {
  const first = text.trim().split("\n")[0] ?? "";
  return first.replace(/^[^：:\s]{1,16}[：:]\s*/, "").slice(0, 24);
}

function cleanFields(fields: RequestFields = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of REQUEST_FIELDS) {
    const v = fields[key]?.trim();
    if (v) out[key] = v.slice(0, 2_000);
  }
  return out;
}

async function storeVerbatim(tx: Tx, productId: string, sourceId: string, version: number, text: string) {
  const ingested = ingestOrThrow(text);
  if (charCount(ingested.text) > MAX_REQUEST_PASTE_CHARS) {
    throw new AppError("invalid_input", `单条需求原文最多 ${MAX_REQUEST_PASTE_CHARS.toLocaleString()} 字符，请拆分`);
  }
  const versionId = newId("sv");
  await tx.insert(sourceVersions).values({
    id: versionId,
    productId,
    sourceId,
    version,
    text: ingested.text,
    contentHash: ingested.hash,
    charCount: ingested.chars,
  });
  // One evidence span over the trimmed text; the stored version keeps any surrounding whitespace.
  const begin = ingested.text.length - ingested.text.trimStart().length;
  const ev = makeEvidence(newId("ev"), { id: versionId, productId, text: ingested.text, validity: "valid" }, { start: begin, end: ingested.text.trimEnd().length });
  await tx.insert(evidences).values({
    id: ev.id,
    productId,
    sourceVersionId: versionId,
    charStart: ev.start,
    charEnd: ev.end,
    lineStart: ev.lineStart,
    lineEnd: ev.lineEnd,
    quote: ev.quote,
    quoteHash: ev.hash,
  });
  const evidenceId = ev.id;
  return { versionId, evidenceId, hash: ingested.hash };
}

/** Requests whose verbatim text matches exactly. Shown as a hint; never merged automatically. */
export async function findDuplicateRequests(db: Db, productId: string, text: string) {
  const { hash } = ingestOrThrow(text);
  return db
    .select({ id: requests.id, party: requests.party })
    .from(requests)
    .innerJoin(evidences, eq(evidences.id, requests.originalEvidenceId))
    .innerJoin(sourceVersions, eq(sourceVersions.id, evidences.sourceVersionId))
    .where(and(eq(requests.productId, productId), eq(sourceVersions.contentHash, hash)));
}

/** Creates a batch atomically. Re-sending the same batch key returns the first result (F03 idempotency). */
export async function createRequests(db: Db, productId: string, batchKey: string, items: NewRequest[]) {
  if (!items.length) throw new AppError("invalid_input", "没有要创建的需求");
  if (items.length > 50) throw new AppError("invalid_input", "一次最多创建 50 条需求");
  if (!batchKey) throw new AppError("invalid_input", "缺少幂等键");
  const ids = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: requests.id })
      .from(requests)
      .where(and(eq(requests.productId, productId), eq(requests.batchKey, batchKey)));
    if (existing.length) return existing.map((r) => r.id);

    const created: string[] = [];
    for (const item of items) {
      const party = item.party.trim();
      if (!party) throw new AppError("invalid_input", "每条需求都需要填写业务方");
      const fields = cleanFields(item.fields);
      const sourceId = newId("src");
      await tx.insert(sources).values({
        id: sourceId,
        productId,
        kind: "request_text",
        name: `${party} · ${fields.title ?? summaryLine(item.originalText)}`,
        originalUrl: item.originalUrl?.trim() || null,
      });
      const { evidenceId } = await storeVerbatim(tx, productId, sourceId, 1, item.originalText);
      const id = newId("req");
      await tx.insert(requests).values({
        id,
        productId,
        originalEvidenceId: evidenceId,
        party,
        sourceName: item.sourceName?.trim() ?? "",
        originalUrl: item.originalUrl?.trim() || null,
        fields,
        batchKey,
      });
      created.push(id);
    }
    return created;
  });
  await touchProduct(db, productId);
  return ids;
}

const requestColumns = {
  id: requests.id,
  productId: requests.productId,
  party: requests.party,
  sourceName: requests.sourceName,
  originalUrl: requests.originalUrl,
  fields: requests.fields,
  revision: requests.revision,
  createdAt: requests.createdAt,
  originalEvidenceId: requests.originalEvidenceId,
  originalText: evidences.quote,
  originalVersionId: evidences.sourceVersionId,
  charStart: evidences.charStart,
  charEnd: evidences.charEnd,
  sourceId: sourceVersions.sourceId,
  version: sourceVersions.version,
  validity: sourceVersions.validity,
};

export async function listRequests(db: Db, productId: string, ids?: string[]) {
  return db
    .select(requestColumns)
    .from(requests)
    .innerJoin(evidences, eq(evidences.id, requests.originalEvidenceId))
    .innerJoin(sourceVersions, eq(sourceVersions.id, evidences.sourceVersionId))
    .where(and(eq(requests.productId, productId), ids ? inArray(requests.id, ids.length ? ids : ["-"]) : undefined))
    .orderBy(asc(requests.createdAt));
}

export async function getRequest(db: Db, productId: string, requestId: string) {
  const [row] = await listRequests(db, productId, [requestId]);
  if (!row) throw notFound("需求");
  return row;
}

export async function updateRequestFields(
  db: Db,
  productId: string,
  requestId: string,
  expectedRevision: number,
  input: { party: string; fields: RequestFields },
) {
  const party = input.party.trim();
  if (!party) throw new AppError("invalid_input", "业务方不能为空");
  const updated = await db
    .update(requests)
    .set({ party, fields: cleanFields(input.fields), revision: expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(requests.productId, productId), eq(requests.id, requestId), eq(requests.revision, expectedRevision)))
    .returning({ id: requests.id });
  if (!updated.length) {
    await getRequest(db, productId, requestId);
    throw revisionConflict();
  }
}

/** Correcting the verbatim text creates a new version; earlier citations keep pointing at the old one. */
export async function correctRequestText(db: Db, productId: string, requestId: string, expectedRevision: number, text: string) {
  const current = await getRequest(db, productId, requestId);
  if (current.revision !== expectedRevision) throw revisionConflict();
  await db.transaction(async (tx) => {
    const [{ latest }] = (await tx
      .select({ latest: max(sourceVersions.version) })
      .from(sourceVersions)
      .where(eq(sourceVersions.sourceId, current.sourceId))) as [{ latest: number | null }];
    const next = (latest ?? 0) + 1;
    await supersedeVersions(tx, productId, current.sourceId);
    const { evidenceId } = await storeVerbatim(tx, productId, current.sourceId, next, text);
    const updated = await tx
      .update(requests)
      .set({ originalEvidenceId: evidenceId, revision: expectedRevision + 1, updatedAt: new Date() })
      .where(and(eq(requests.id, requestId), eq(requests.revision, expectedRevision)))
      .returning({ id: requests.id });
    if (!updated.length) throw revisionConflict();
  });
}
