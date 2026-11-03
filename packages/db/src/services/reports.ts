// Report versions (PRD F08): immutable snapshots assembled from reviewed
// claims, rendered to Markdown programmatically.

import {
  EvidenceRegistry,
  renderReportMarkdown,
  renderSpecMarkdown,
  reportStatus,
  type ClaimRecord,
  type Lang,
  type ReportSnapshot,
} from "@pew/core";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { Db } from "../client";
import { notFound } from "../errors";
import { analyses, decisions, evidences, reportVersions, sourceVersions, sources } from "../schema";
import { getAnalysis, setAnalysisStatus } from "./analyses";
import { listClaims } from "./claims";
import { listRequests } from "./requests";

export const TEMPLATE_VERSION = "report-v0.1";
export const EXPORT_SCHEMA = "pew-report/1";

export async function buildSnapshot(db: Db, productId: string, analysisId: string): Promise<ReportSnapshot> {
  const analysis = await getAnalysis(db, productId, analysisId);
  const reqs = await listRequests(db, productId, analysis.requestIds);
  const ordered = analysis.requestIds.map((id) => reqs.find((r) => r.id === id)!).filter(Boolean);
  const claimViews = await listClaims(db, productId, analysisId);

  const citedIds = [...new Set(claimViews.flatMap((c) => c.evidenceIds))];
  const evRows = citedIds.length
    ? await db
        .select({ ev: evidences, version: sourceVersions.version, validity: sourceVersions.validity, sourceName: sources.name })
        .from(evidences)
        .innerJoin(sourceVersions, eq(sourceVersions.id, evidences.sourceVersionId))
        .innerJoin(sources, eq(sources.id, sourceVersions.sourceId))
        .where(and(eq(evidences.productId, productId), inArray(evidences.id, citedIds)))
    : [];
  const registry = new EvidenceRegistry(
    evRows.map(({ ev, validity }) => ({
      evidence: {
        id: ev.id,
        productId: ev.productId,
        sourceVersionId: ev.sourceVersionId,
        start: ev.charStart,
        end: ev.charEnd,
        lineStart: ev.lineStart,
        lineEnd: ev.lineEnd,
        quote: ev.quote ?? "",
        hash: ev.quoteHash,
      },
      validity,
    })),
  );
  const handleOf = new Map(registry.entries().map((e) => [e.evidenceId, e.handle]));

  const claimsForReport: ClaimRecord[] = claimViews.map(({ evidenceIds, runId: _r, taskType: _t, ...c }) => ({
    ...c,
    evidence: evidenceIds.map((id) => ({ handle: handleOf.get(id) ?? id })),
  }));
  const decisionRows = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.productId, productId), eq(decisions.analysisId, analysisId)));
  const modelRun = claimViews.find((c) => c.taskType !== "manual");

  return {
    title: analysis.title,
    goal: analysis.goal,
    changeDescription: analysis.changeDescription || undefined,
    createdAt: new Date().toISOString(),
    requests: ordered.map((r, i) => ({
      handle: `R${i + 1}`,
      evidenceId: r.originalEvidenceId,
      party: r.party,
      title: (r.fields as Record<string, string>).title ?? "",
      originalText: r.originalText ?? "［来源已删除，原句不再保留］",
    })),
    sources: analysis.selectedSources.map((s) => ({ name: s.name, version: s.version, validity: s.validity, sourceVersionId: s.versionId })),
    coverage: [],
    claims: claimsForReport,
    evidence: registry.entries().map((e) => {
      const row = evRows.find((r) => r.ev.id === e.evidenceId)!;
      return {
        handle: e.handle,
        evidenceId: e.evidenceId,
        sourceName: row.sourceName,
        sourceVersion: row.version,
        lineStart: row.ev.lineStart,
        lineEnd: row.ev.lineEnd,
        quote: row.ev.quote,
        validity: e.validity,
      };
    }),
    decisions: decisionRows.map((d) => ({ text: d.content, reason: d.reason, decidedAt: d.decidedAt.toISOString().slice(0, 10) })),
    openQuestions: [],
    model: modelRun ? { provider: "preset", model: modelRun.taskType } : undefined,
    templateVersion: TEMPLATE_VERSION,
  };
}

export async function saveReportVersion(db: Db, productId: string, analysisId: string) {
  const snapshot = await buildSnapshot(db, productId, analysisId);
  const status = reportStatus(snapshot);
  const row = await db.transaction(async (tx) => {
    const [{ latest }] = (await tx
      .select({ latest: max(reportVersions.version) })
      .from(reportVersions)
      .where(eq(reportVersions.analysisId, analysisId))) as [{ latest: number | null }];
    const [inserted] = await tx
      .insert(reportVersions)
      .values({
        id: `rep_${crypto.randomUUID().replace(/-/g, "")}`,
        productId,
        analysisId,
        version: (latest ?? 0) + 1,
        status,
        snapshot,
        exportSchema: EXPORT_SCHEMA,
      })
      .returning();
    return inserted!;
  });
  await setAnalysisStatus(db, productId, analysisId, "report_saved");
  await db.update(analyses).set({ updatedAt: new Date() }).where(eq(analyses.id, analysisId));
  return row;
}

export async function listReportVersions(db: Db, productId: string, analysisId: string) {
  return db
    .select({ id: reportVersions.id, version: reportVersions.version, status: reportVersions.status, createdAt: reportVersions.createdAt })
    .from(reportVersions)
    .where(and(eq(reportVersions.productId, productId), eq(reportVersions.analysisId, analysisId)))
    .orderBy(desc(reportVersions.version));
}

export async function getReportVersion(db: Db, productId: string, analysisId: string, version: number) {
  const [row] = await db
    .select()
    .from(reportVersions)
    .where(and(eq(reportVersions.productId, productId), eq(reportVersions.analysisId, analysisId), eq(reportVersions.version, version)));
  if (!row) throw notFound("报告版本");
  return { ...row, snapshot: row.snapshot as ReportSnapshot };
}

export function renderReport(snapshot: ReportSnapshot, kind: "report" | "spec", lang: Lang) {
  return kind === "spec" ? renderSpecMarkdown(snapshot, lang) : renderReportMarkdown(snapshot, lang);
}
