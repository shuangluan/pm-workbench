// Sources, versions and evidence (PRD F04, §3.3, §8.3).

import { charCount, findQuote, ingestText, makeEvidence, type IngestResult } from "@pew/core";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "../client";
import { AppError, newId, notFound } from "../errors";
import { analysisRuns, claimEvidences, claims, evidences, reportVersions, sourceVersions, sources } from "../schema";
import { touchProduct } from "./products";

const INGEST_MESSAGES: Record<Exclude<IngestResult, { ok: true }>["code"], string> = {
  empty: "内容为空",
  too_large: "文件超过 2 MB",
  invalid_encoding: "不是 UTF-8 编码，请转换为 UTF-8 后再上传",
  too_many_chars: "解析后超过 100,000 字符，请拆分后再上传",
};

export function ingestOrThrow(raw: string) {
  const r = ingestText(raw);
  if (!r.ok) throw new AppError("invalid_input", INGEST_MESSAGES[r.code], { code: r.code });
  return r;
}

export type AddSourceResult =
  | { status: "created"; sourceId: string; versionId: string }
  | { status: "duplicate"; sourceId: string; versionId: string; name: string };

/** Identical content (by hash) is reused instead of stored twice. A same-named source is never overwritten. */
export async function addSource(
  db: Db,
  productId: string,
  input: { name: string; text: string; kind?: "file" | "paste"; originalUrl?: string },
): Promise<AddSourceResult> {
  const name = input.name.trim();
  if (!name) throw new AppError("invalid_input", "资料名称不能为空");
  const ingested = ingestOrThrow(input.text);

  const [dup] = await db
    .select({ sourceId: sources.id, versionId: sourceVersions.id, name: sources.name })
    .from(sourceVersions)
    .innerJoin(sources, eq(sources.id, sourceVersions.sourceId))
    .where(
      and(
        eq(sourceVersions.productId, productId),
        eq(sourceVersions.contentHash, ingested.hash),
        eq(sourceVersions.validity, "valid"),
        ne(sources.kind, "request_text"),
      ),
    );
  if (dup) return { status: "duplicate", ...dup };

  const sourceId = newId("src");
  const versionId = newId("sv");
  await db.transaction(async (tx) => {
    await tx.insert(sources).values({ id: sourceId, productId, kind: input.kind ?? "paste", name, originalUrl: input.originalUrl?.trim() || null });
    await tx.insert(sourceVersions).values({
      id: versionId,
      productId,
      sourceId,
      version: 1,
      text: ingested.text,
      contentHash: ingested.hash,
      charCount: ingested.chars,
    });
  });
  await touchProduct(db, productId);
  return { status: "created", sourceId, versionId };
}

/** Older versions become "needs review"; claims citing them are flagged, never re-pointed (§3.3 rule 5). */
export async function supersedeVersions(tx: Tx, productId: string, sourceId: string) {
  const old = await tx
    .update(sourceVersions)
    .set({ validity: "needs_review" })
    .where(and(eq(sourceVersions.productId, productId), eq(sourceVersions.sourceId, sourceId), eq(sourceVersions.validity, "valid")))
    .returning({ id: sourceVersions.id });
  if (!old.length) return;
  const evIds = (
    await tx
      .select({ id: evidences.id })
      .from(evidences)
      .where(inArray(evidences.sourceVersionId, old.map((o) => o.id)))
  ).map((e) => e.id);
  if (!evIds.length) return;
  const claimIds = (
    await tx.select({ id: claimEvidences.claimId }).from(claimEvidences).where(inArray(claimEvidences.evidenceId, evIds))
  ).map((c) => c.id);
  if (claimIds.length) {
    await tx
      .update(claims)
      .set({ evidenceValidity: "needs_review" })
      .where(and(inArray(claims.id, claimIds), eq(claims.evidenceValidity, "valid")));
  }
}

export async function addSourceVersion(db: Db, productId: string, sourceId: string, text: string) {
  const ingested = ingestOrThrow(text);
  const source = await getSource(db, productId, sourceId);
  const latest = source.versions[0];
  if (latest?.validity === "source_deleted") throw new AppError("invalid_input", "该资料已永久删除");
  if (latest?.contentHash === ingested.hash) return { status: "unchanged" as const, versionId: latest.id };
  const versionId = newId("sv");
  await db.transaction(async (tx) => {
    await supersedeVersions(tx, productId, sourceId);
    await tx.insert(sourceVersions).values({
      id: versionId,
      productId,
      sourceId,
      version: (latest?.version ?? 0) + 1,
      text: ingested.text,
      contentHash: ingested.hash,
      charCount: ingested.chars,
    });
  });
  await touchProduct(db, productId);
  return { status: "created" as const, versionId };
}

export async function listSources(db: Db, productId: string) {
  const rows = await db
    .select({
      id: sources.id,
      name: sources.name,
      kind: sources.kind,
      versionId: sourceVersions.id,
      version: sourceVersions.version,
      validity: sourceVersions.validity,
      charCount: sourceVersions.charCount,
      createdAt: sourceVersions.createdAt,
    })
    .from(sources)
    .innerJoin(sourceVersions, eq(sourceVersions.sourceId, sources.id))
    .where(and(eq(sources.productId, productId), ne(sources.kind, "request_text")))
    .orderBy(asc(sources.name), desc(sourceVersions.version));
  const latest = new Map<string, (typeof rows)[number] & { versionCount: number }>();
  for (const r of rows) {
    const seen = latest.get(r.id);
    if (seen) seen.versionCount++;
    else latest.set(r.id, { ...r, versionCount: 1 });
  }
  return [...latest.values()];
}

export async function getSource(db: Db, productId: string, sourceId: string) {
  const [source] = await db.select().from(sources).where(and(eq(sources.productId, productId), eq(sources.id, sourceId)));
  if (!source) throw notFound("资料");
  const versions = await db
    .select()
    .from(sourceVersions)
    .where(and(eq(sourceVersions.productId, productId), eq(sourceVersions.sourceId, sourceId)))
    .orderBy(desc(sourceVersions.version));
  return { ...source, versions };
}

export async function getVersionWithEvidence(db: Db, productId: string, versionId: string) {
  const [version] = await db
    .select()
    .from(sourceVersions)
    .where(and(eq(sourceVersions.productId, productId), eq(sourceVersions.id, versionId)));
  if (!version) throw notFound("资料版本");
  const evs = await db
    .select()
    .from(evidences)
    .where(and(eq(evidences.productId, productId), eq(evidences.sourceVersionId, versionId)))
    .orderBy(asc(evidences.charStart));
  const usage = evs.length
    ? await db
        .select({ evidenceId: claimEvidences.evidenceId, n: count() })
        .from(claimEvidences)
        .where(inArray(claimEvidences.evidenceId, evs.map((e) => e.id)))
        .groupBy(claimEvidences.evidenceId)
    : [];
  return {
    version,
    evidences: evs.map((e) => ({ ...e, claimCount: usage.find((u) => u.evidenceId === e.id)?.n ?? 0 })),
  };
}

/** Cite by pasting the exact sentence. Ambiguous quotes are refused rather than guessed. */
export async function addEvidenceByQuote(db: Db | Tx, productId: string, versionId: string, quote: string) {
  const [version] = await db
    .select()
    .from(sourceVersions)
    .where(and(eq(sourceVersions.productId, productId), eq(sourceVersions.id, versionId)));
  if (!version) throw notFound("资料版本");
  if (version.validity !== "valid" || version.text === null) {
    throw new AppError("invalid_input", "只能在当前有效版本中添加引用");
  }
  const trimmed = quote.trim();
  if (!trimmed) throw new AppError("invalid_input", "引用原句不能为空");
  if (charCount(trimmed) > 2_000) throw new AppError("invalid_input", "单条引用最多 2,000 字符");
  const hits = findQuote(version.text, trimmed);
  if (!hits.length) throw new AppError("not_found", "在该版本中找不到这段原句，请直接从原文复制");
  if (hits.length > 1) throw new AppError("ambiguous", `这段文字在原文中出现了 ${hits.length} 次，请多选几个字使其唯一`, { occurrences: hits.length });
  const span = hits[0]!;
  const [existing] = await db
    .select()
    .from(evidences)
    .where(and(eq(evidences.sourceVersionId, versionId), eq(evidences.charStart, span.start), eq(evidences.charEnd, span.end)));
  if (existing) return existing;
  const ev = makeEvidence(newId("ev"), { id: version.id, productId, text: version.text, validity: "valid" }, span);
  const [row] = await db
    .insert(evidences)
    .values({
      id: ev.id,
      productId,
      sourceVersionId: versionId,
      charStart: ev.start,
      charEnd: ev.end,
      lineStart: ev.lineStart,
      lineEnd: ev.lineEnd,
      quote: ev.quote,
      quoteHash: ev.hash,
    })
    .returning();
  return row!;
}

async function evidenceIdsOfSource(db: Db | Tx, productId: string, sourceId: string) {
  return (
    await db
      .select({ id: evidences.id })
      .from(evidences)
      .innerJoin(sourceVersions, eq(sourceVersions.id, evidences.sourceVersionId))
      .where(and(eq(evidences.productId, productId), eq(sourceVersions.sourceId, sourceId)))
  ).map((e) => e.id);
}

export async function sourceDeletionPreview(db: Db, productId: string, sourceId: string) {
  const source = await getSource(db, productId, sourceId);
  const evIds = await evidenceIdsOfSource(db, productId, sourceId);
  const claimCount = evIds.length
    ? (await db.select({ n: count() }).from(claimEvidences).where(inArray(claimEvidences.evidenceId, evIds)))[0]!.n
    : 0;
  const reports = await reportsCiting(db, productId, evIds, source.versions.map((v) => v.id));
  return { source, versions: source.versions.length, evidences: evIds.length, claims: claimCount, reports: reports.length };
}

async function reportsCiting(db: Db | Tx, productId: string, evidenceIds: string[], versionIds: string[] = []) {
  if (!evidenceIds.length && !versionIds.length) return [];
  const all = await db
    .select({ id: reportVersions.id, snapshot: reportVersions.snapshot })
    .from(reportVersions)
    .where(eq(reportVersions.productId, productId));
  const wanted = new Set(evidenceIds);
  const versions = new Set(versionIds);
  return all.filter((r) => {
    const snap = r.snapshot as {
      evidence?: { evidenceId?: string }[];
      requests?: { evidenceId?: string }[];
      sources?: { sourceVersionId?: string }[];
    };
    return (
      [...(snap.evidence ?? []), ...(snap.requests ?? [])].some((e) => e.evidenceId && wanted.has(e.evidenceId)) ||
      (snap.sources ?? []).some((s) => s.sourceVersionId && versions.has(s.sourceVersionId))
    );
  });
}

export const DELETED_PLACEHOLDER = "［来源已删除，原句不再保留］";

/**
 * Permanent deletion (§8.3): text and quotes are removed everywhere this
 * database keeps them, including saved report snapshots. The rows stay as
 * tombstones so history shows that something was deleted, and when.
 */
export async function deleteSourcePermanently(db: Db, productId: string, sourceId: string) {
  await getSource(db, productId, sourceId);
  const now = new Date();
  await db.transaction(async (tx) => {
    const versionIds = (
      await tx
        .update(sourceVersions)
        .set({ text: null, validity: "source_deleted", deletedAt: now, storageKey: null })
        .where(and(eq(sourceVersions.productId, productId), eq(sourceVersions.sourceId, sourceId)))
        .returning({ id: sourceVersions.id })
    ).map((v) => v.id);
    const evIds = await evidenceIdsOfSource(tx, productId, sourceId);
    if (evIds.length) {
      await tx.update(evidences).set({ quote: null }).where(inArray(evidences.id, evIds));
      const claimIds = (
        await tx.select({ id: claimEvidences.claimId }).from(claimEvidences).where(inArray(claimEvidences.evidenceId, evIds))
      ).map((c) => c.id);
      if (claimIds.length) await tx.update(claims).set({ evidenceValidity: "source_deleted" }).where(inArray(claims.id, claimIds));
    }
    // Unfinished runs that froze this source in their input are canceled.
    for (const versionId of versionIds) {
      await tx
        .update(analysisRuns)
        .set({ status: "canceled", finishedAt: now, errorKind: "source_deleted" })
        .where(
          and(
            eq(analysisRuns.productId, productId),
            inArray(analysisRuns.status, ["queued", "running"]),
            sql`${analysisRuns.inputSnapshot} -> 'sourceVersionIds' ? ${versionId}`,
          ),
        );
    }
    const wanted = new Set(evIds);
    const touched = await reportsCiting(tx, productId, evIds, versionIds);
    for (const report of touched) {
      const snap = structuredClone(report.snapshot) as {
        evidence: { evidenceId?: string; handle: string; quote: string | null; validity: string }[];
        requests: { evidenceId?: string; originalText: string }[];
        claims: { evidence: { handle: string }[]; evidenceValidity: string }[];
        sources: { sourceVersionId?: string; validity: string }[];
      };
      const deletedVersions = new Set(versionIds);
      for (const src of snap.sources) if (src.sourceVersionId && deletedVersions.has(src.sourceVersionId)) src.validity = "source_deleted";
      const deletedHandles = new Set<string>();
      for (const e of snap.evidence) {
        if (e.evidenceId && wanted.has(e.evidenceId)) {
          e.quote = null;
          e.validity = "source_deleted";
          deletedHandles.add(e.handle);
        }
      }
      for (const r of snap.requests) if (r.evidenceId && wanted.has(r.evidenceId)) r.originalText = DELETED_PLACEHOLDER;
      for (const c of snap.claims) if (c.evidence.some((e) => deletedHandles.has(e.handle))) c.evidenceValidity = "source_deleted";
      await tx.update(reportVersions).set({ snapshot: snap }).where(eq(reportVersions.id, report.id));
    }
  });
  await touchProduct(db, productId);
}

/** Evidence with its source and version, for citation display and pickers. */
export async function listEvidence(db: Db, productId: string, filter: { ids?: string[]; versionIds?: string[] }) {
  const cond = filter.ids
    ? inArray(evidences.id, filter.ids.length ? filter.ids : ["-"])
    : inArray(evidences.sourceVersionId, filter.versionIds?.length ? filter.versionIds : ["-"]);
  return db
    .select({
      id: evidences.id,
      quote: evidences.quote,
      lineStart: evidences.lineStart,
      lineEnd: evidences.lineEnd,
      versionId: sourceVersions.id,
      version: sourceVersions.version,
      validity: sourceVersions.validity,
      sourceId: sources.id,
      sourceName: sources.name,
      sourceKind: sources.kind,
    })
    .from(evidences)
    .innerJoin(sourceVersions, eq(sourceVersions.id, evidences.sourceVersionId))
    .innerJoin(sources, eq(sources.id, sourceVersions.sourceId))
    .where(and(eq(evidences.productId, productId), cond))
    .orderBy(asc(sources.name), asc(evidences.charStart));
}
