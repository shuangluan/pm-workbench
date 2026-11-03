import { and, count, desc, eq, inArray, max, ne } from "drizzle-orm";
import type { Db } from "../client";
import { AppError, newId, notFound } from "../errors";
import { analyses, analysisRuns, products, reportVersions, requests, sources } from "../schema";

export async function createProduct(db: Db, input: { name: string; description?: string }) {
  const name = input.name.trim();
  if (!name) throw new AppError("invalid_input", "产品名称不能为空");
  if (name.length > 120) throw new AppError("invalid_input", "产品名称最多 120 个字符");
  const [row] = await db
    .insert(products)
    .values({ id: newId("prod"), name, description: (input.description ?? "").trim() })
    .returning();
  return row!;
}

export async function listProducts(db: Db) {
  const rows = await db.select().from(products).orderBy(desc(products.updatedAt));
  const analysisStats = await db
    .select({ productId: analyses.productId, n: count(), last: max(analyses.updatedAt) })
    .from(analyses)
    .groupBy(analyses.productId);
  const sourceStats = await db
    .select({ productId: sources.productId, n: count() })
    .from(sources)
    .where(ne(sources.kind, "request_text"))
    .groupBy(sources.productId);
  return rows.map((p) => {
    const a = analysisStats.find((s) => s.productId === p.id);
    return {
      ...p,
      analysisCount: a?.n ?? 0,
      lastAnalysisAt: a?.last ?? null,
      sourceCount: sourceStats.find((s) => s.productId === p.id)?.n ?? 0,
    };
  });
}

export async function getProduct(db: Db, productId: string) {
  const [row] = await db.select().from(products).where(eq(products.id, productId));
  if (!row) throw notFound("产品");
  return row;
}

export async function productDeletionPreview(db: Db, productId: string) {
  const product = await getProduct(db, productId);
  const [a] = await db.select({ n: count() }).from(analyses).where(eq(analyses.productId, productId));
  const [r] = await db.select({ n: count() }).from(reportVersions).where(eq(reportVersions.productId, productId));
  const [q] = await db.select({ n: count() }).from(requests).where(eq(requests.productId, productId));
  const [sourceCount] = await db
    .select({ n: count() })
    .from(sources)
    .where(and(eq(sources.productId, productId), ne(sources.kind, "request_text")));
  return {
    product,
    analyses: a!.n,
    reports: r!.n,
    requests: q!.n,
    sources: sourceCount!.n,
  };
}

/** Requires the product name typed back. Unfinished runs are canceled before the cascade removes them. */
export async function deleteProduct(db: Db, productId: string, confirmName: string) {
  const product = await getProduct(db, productId);
  if (!product.isExample && confirmName.trim() !== product.name) {
    throw new AppError("invalid_input", "输入的产品名称不一致，未删除");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(analysisRuns)
      .set({ status: "canceled", finishedAt: new Date() })
      .where(and(eq(analysisRuns.productId, productId), inArray(analysisRuns.status, ["queued", "running"])));
    await tx.delete(products).where(eq(products.id, productId));
  });
}

export async function touchProduct(db: Db, productId: string) {
  await db.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
}
