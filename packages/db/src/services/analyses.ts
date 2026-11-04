// Analyses and their input scope (PRD F02).

import { transitionAnalysis, type AnalysisStatus } from "@pew/core";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { AppError, newId, notFound, revisionConflict } from "../errors";
import { analyses, analysisRequests, analysisSources, reportVersions, sourceVersions, sources } from "../schema";
import { touchProduct } from "./products";

export async function createAnalysis(db: Db, productId: string, input: { title: string; goal?: string; changeDescription?: string }) {
  const title = input.title.trim();
  if (!title) throw new AppError("invalid_input", "分析标题不能为空");
  const [row] = await db
    .insert(analyses)
    .values({ id: newId("ana"), productId, title, goal: input.goal?.trim() ?? "", changeDescription: input.changeDescription?.trim() ?? "" })
    .returning();
  await touchProduct(db, productId);
  return row!;
}

export async function listAnalyses(db: Db, productId: string) {
  return db.select().from(analyses).where(eq(analyses.productId, productId)).orderBy(desc(analyses.updatedAt));
}

export async function getAnalysis(db: Db, productId: string, analysisId: string) {
  const [analysis] = await db.select().from(analyses).where(and(eq(analyses.productId, productId), eq(analyses.id, analysisId)));
  if (!analysis) throw notFound("分析任务");
  const requestIds = (
    await db
      .select({ id: analysisRequests.requestId })
      .from(analysisRequests)
      .where(eq(analysisRequests.analysisId, analysisId))
      .orderBy(asc(analysisRequests.position))
  ).map((r) => r.id);
  const selectedSources = await db
    .select({
      versionId: sourceVersions.id,
      sourceId: sources.id,
      name: sources.name,
      kind: sources.kind,
      version: sourceVersions.version,
      validity: sourceVersions.validity,
      charCount: sourceVersions.charCount,
    })
    .from(analysisSources)
    .innerJoin(sourceVersions, eq(sourceVersions.id, analysisSources.sourceVersionId))
    .innerJoin(sources, eq(sources.id, sourceVersions.sourceId))
    .where(eq(analysisSources.analysisId, analysisId))
    .orderBy(asc(sources.name));
  return { ...analysis, requestIds, selectedSources };
}

function assertEditable(status: AnalysisStatus) {
  if (status === "archived") throw new AppError("invalid_input", "已归档的分析不能修改，请先取消归档");
}

export async function updateAnalysis(
  db: Db,
  productId: string,
  analysisId: string,
  expectedRevision: number,
  input: { title: string; goal: string; changeDescription: string },
) {
  const current = await getAnalysis(db, productId, analysisId);
  assertEditable(current.status);
  const title = input.title.trim();
  if (!title) throw new AppError("invalid_input", "分析标题不能为空");
  const updated = await db
    .update(analyses)
    .set({ title, goal: input.goal.trim(), changeDescription: input.changeDescription.trim(), revision: expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(analyses.id, analysisId), eq(analyses.revision, expectedRevision)))
    .returning({ id: analyses.id });
  if (!updated.length) throw revisionConflict();
}

/**
 * Replace the selected requests and source versions. Changing scope after a
 * report was saved sends the analysis back to draft; saved reports stay as they are.
 */
export async function setAnalysisScope(
  db: Db,
  productId: string,
  analysisId: string,
  expectedRevision: number,
  scope: { requestIds: string[]; sourceVersionIds: string[] },
) {
  const current = await getAnalysis(db, productId, analysisId);
  assertEditable(current.status);
  const requestIds = [...new Set(scope.requestIds)];
  const versionIds = [...new Set(scope.sourceVersionIds)];
  if (versionIds.length) {
    const versions = await db
      .select({ id: sourceVersions.id, validity: sourceVersions.validity })
      .from(sourceVersions)
      .where(and(eq(sourceVersions.productId, productId), inArray(sourceVersions.id, versionIds)));
    if (versions.length !== versionIds.length) throw notFound("资料版本");
    if (versions.some((v) => v.validity === "source_deleted")) throw new AppError("invalid_input", "不能选择已删除的资料");
  }
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(analyses)
      .set({
        revision: expectedRevision + 1,
        updatedAt: new Date(),
        status: current.status === "draft" ? "draft" : transitionAnalysis(current.status, "draft"),
      })
      .where(and(eq(analyses.id, analysisId), eq(analyses.revision, expectedRevision)))
      .returning({ id: analyses.id });
    if (!updated.length) throw revisionConflict();
    await tx.delete(analysisRequests).where(eq(analysisRequests.analysisId, analysisId));
    await tx.delete(analysisSources).where(eq(analysisSources.analysisId, analysisId));
    // Composite foreign keys reject ids from another product here.
    if (requestIds.length) {
      await tx.insert(analysisRequests).values(requestIds.map((requestId, position) => ({ productId, analysisId, requestId, position })));
    }
    if (versionIds.length) {
      await tx.insert(analysisSources).values(versionIds.map((sourceVersionId) => ({ productId, analysisId, sourceVersionId })));
    }
  });
}

export async function setAnalysisStatus(db: Db, productId: string, analysisId: string, to: AnalysisStatus) {
  const current = await getAnalysis(db, productId, analysisId);
  if (current.status === to) return;
  await db
    .update(analyses)
    .set({ status: transitionAnalysis(current.status, to), updatedAt: new Date() })
    .where(eq(analyses.id, analysisId));
}

export async function deleteAnalysis(db: Db, productId: string, analysisId: string) {
  await getAnalysis(db, productId, analysisId);
  // Runs, claims and report versions cascade. Product sources and requests are kept.
  await db.delete(analyses).where(and(eq(analyses.productId, productId), eq(analyses.id, analysisId)));
}

export async function analysisDeletionPreview(db: Db, productId: string, analysisId: string) {
  const analysis = await getAnalysis(db, productId, analysisId);
  const reports = await db.select({ id: reportVersions.id }).from(reportVersions).where(eq(reportVersions.analysisId, analysisId));
  return { analysis, reports: reports.length };
}

/** Add to the scope without removing anything (used when items are created from within an analysis). */
export async function appendToScope(db: Db, productId: string, analysisId: string, add: { requestIds?: string[]; sourceVersionIds?: string[] }) {
  const current = await getAnalysis(db, productId, analysisId);
  assertEditable(current.status);
  const newRequests = (add.requestIds ?? []).filter((id) => !current.requestIds.includes(id));
  const have = new Set(current.selectedSources.map((s) => s.versionId));
  const newVersions = [...new Set(add.sourceVersionIds ?? [])].filter((id) => !have.has(id));
  if (!newRequests.length && !newVersions.length) return;
  await db.transaction(async (tx) => {
    if (newRequests.length) {
      await tx
        .insert(analysisRequests)
        .values(newRequests.map((requestId, i) => ({ productId, analysisId, requestId, position: current.requestIds.length + i })));
    }
    if (newVersions.length) await tx.insert(analysisSources).values(newVersions.map((sourceVersionId) => ({ productId, analysisId, sourceVersionId })));
    await tx
      .update(analyses)
      .set({ revision: current.revision + 1, updatedAt: new Date() })
      .where(eq(analyses.id, analysisId));
  });
}
