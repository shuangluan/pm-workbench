// Local memory as core graph types, and the analysis's changed nodes (F05, F07).

import { impactQuery, type ImpactResult, type SystemEdge, type SystemNode } from "@pew/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { AppError, notFound } from "../errors";
import { analyses, edgeEvidences, systemEdges, systemNodes } from "../schema";

export async function loadMemory(db: Db, productId: string): Promise<{ nodes: SystemNode[]; edges: SystemEdge[] }> {
  const nodeRows = await db
    .select()
    .from(systemNodes)
    .where(and(eq(systemNodes.productId, productId), isNull(systemNodes.mergedInto)));
  const edgeRows = await db.select().from(systemEdges).where(eq(systemEdges.productId, productId));
  const links = edgeRows.length
    ? await db.select().from(edgeEvidences).where(inArray(edgeEvidences.edgeId, edgeRows.map((e) => e.id)))
    : [];
  return {
    nodes: nodeRows.map((n) => ({ id: n.id, productId, type: n.type, name: n.name, aliases: n.aliases })),
    edges: edgeRows.map((e) => ({
      id: e.id,
      productId,
      from: e.fromNodeId,
      to: e.toNodeId,
      type: e.type,
      confirmation: e.confirmation,
      validity: e.validity,
      basis: e.basis ?? undefined,
      evidenceIds: links.filter((l) => l.edgeId === e.id).map((l) => l.evidenceId),
      confirmedAt: e.confirmedAt?.toISOString(),
    })),
  };
}

export async function setChangeNodes(db: Db, productId: string, analysisId: string, nodeIds: string[]) {
  const unique = [...new Set(nodeIds)];
  if (unique.length) {
    const found = await db
      .select({ id: systemNodes.id })
      .from(systemNodes)
      .where(and(eq(systemNodes.productId, productId), inArray(systemNodes.id, unique)));
    if (found.length !== unique.length) throw notFound("节点");
  }
  const updated = await db
    .update(analyses)
    .set({ changeNodeIds: unique, updatedAt: new Date() })
    .where(and(eq(analyses.productId, productId), eq(analyses.id, analysisId)))
    .returning({ status: analyses.status });
  if (!updated.length) throw notFound("分析任务");
  if (updated[0]!.status === "archived") throw new AppError("invalid_input", "已归档的分析不能修改");
}

/** Deterministic confirmed-dependency check for the analysis's changed nodes, or null when none are chosen. */
export async function analysisImpact(
  db: Db,
  productId: string,
  changeNodeIds: string[],
): Promise<{ result: ImpactResult; nodes: SystemNode[]; edges: SystemEdge[] } | null> {
  if (!changeNodeIds.length) return null;
  const { nodes, edges } = await loadMemory(db, productId);
  const known = changeNodeIds.filter((id) => nodes.some((n) => n.id === id));
  if (!known.length) return null;
  return { result: impactQuery(nodes, edges, known), nodes, edges };
}
