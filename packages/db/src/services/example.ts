// Loads the synthetic §10.3 example as its own product (F01). Preset claims
// arrive as pending model output so the review flow can be tried without a model.

import { charCount, sha256 } from "@pew/core";
import { eq } from "drizzle-orm";
import * as example from "../../../../examples/batch-export";
import type { Db } from "../client";
import { newId } from "../errors";
import {
  analyses,
  analysisRequests,
  analysisRuns,
  analysisSources,
  claimEvidences,
  claims,
  evidences,
  products,
  sourceVersions,
  sources,
  systemEdges,
  systemNodes,
} from "../schema";
import { createRequests } from "./requests";

export async function findExampleProduct(db: Db) {
  const [row] = await db.select().from(products).where(eq(products.isExample, true));
  return row ?? null;
}

export async function loadExample(db: Db): Promise<string> {
  const existing = await findExampleProduct(db);
  if (existing) return existing.id;

  const productId = newId("prod");
  const ids = new Map<string, string>();
  const map = (old: string, prefix: string) => {
    if (!ids.has(old)) ids.set(old, newId(prefix));
    return ids.get(old)!;
  };

  await db.transaction(async (tx) => {
    await tx.insert(products).values({
      id: productId,
      name: "客户管理平台（示例）",
      description: `${example.EXAMPLE_LABEL}：合成公司与需求，可一键清除。`,
      isExample: true,
    });
    for (const s of example.sources) {
      const sourceId = newId("src");
      await tx.insert(sources).values({ id: sourceId, productId, kind: "paste", name: s.name });
      await tx.insert(sourceVersions).values({
        id: map(s.sv.id, "sv"),
        productId,
        sourceId,
        version: s.version,
        text: s.sv.text,
        contentHash: sha256(s.sv.text),
        charCount: charCount(s.sv.text),
      });
    }
    for (const e of example.evidence) {
      await tx.insert(evidences).values({
        id: map(e.id, "ev"),
        productId,
        sourceVersionId: ids.get(e.sourceVersionId)!,
        charStart: e.start,
        charEnd: e.end,
        lineStart: e.lineStart,
        lineEnd: e.lineEnd,
        quote: e.quote,
        quoteHash: e.hash,
      });
    }
    for (const n of example.nodes) {
      await tx.insert(systemNodes).values({ id: map(n.id, "node"), productId, type: n.type, name: n.name });
    }
    for (const e of example.edges) {
      await tx.insert(systemEdges).values({
        id: map(e.id, "edge"),
        productId,
        fromNodeId: ids.get(e.from)!,
        toNodeId: ids.get(e.to)!,
        type: e.type,
        confirmation: "confirmed",
        basis: "user_asserted",
        note: "示例：用户确认，暂无文档佐证",
        confirmedAt: new Date(),
      });
    }
  });

  const requestIds = await createRequests(
    db,
    productId,
    `example:${productId}`,
    example.requests.map((r) => ({ party: r.party, originalText: r.originalText, sourceName: "示例访谈", fields: { title: r.title } })),
  );

  const analysisId = newId("ana");
  const runId = newId("run");
  await db.transaction(async (tx) => {
    await tx.insert(analyses).values({
      id: analysisId,
      productId,
      title: "统一批量导出能力",
      goal: "判断三方导出诉求能否归入一个通用导出能力，并检查权限服务变更的影响。",
      changeDescription: "调整权限服务的客户可见范围判定。",
      changeNodeIds: [ids.get("n_permission")!],
      status: "pending_review",
    });
    await tx.insert(analysisRequests).values(requestIds.map((requestId, position) => ({ productId, analysisId, requestId, position })));
    await tx.insert(analysisSources).values(example.sources.map((s) => ({ productId, analysisId, sourceVersionId: ids.get(s.sv.id)! })));
    await tx.insert(analysisRuns).values({
      id: runId,
      productId,
      analysisId,
      taskType: "abstraction",
      status: "succeeded",
      idempotencyKey: `example:${runId}`,
      inputSnapshot: { preset: true, sourceVersionIds: example.sources.map((s) => ids.get(s.sv.id)!) },
      finishedAt: new Date(),
    });
    for (const [position, draft] of example.abstractionDrafts.entries()) {
      const claimId = newId("cl");
      await tx.insert(claims).values({
        id: claimId,
        productId,
        runId,
        position,
        section: draft.section,
        kind: draft.kind,
        origin: "model",
        text: draft.text,
        reasoning: draft.reasoning ?? null,
        missing: draft.missing ?? null,
      });
      const evIds = draft.evidence.map((ref) => ids.get(example.registry.get(ref.handle)!.evidenceId)!);
      if (evIds.length) {
        await tx.insert(claimEvidences).values(evIds.map((evidenceId, i) => ({ productId, claimId, evidenceId, position: i })));
      }
    }
  });
  return productId;
}
