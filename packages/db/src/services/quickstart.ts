// One-step start (lowering the first-use barrier): product, sources,
// screenshots, requests and an analysis with its scope already selected.
// Ids derive from the form's batch key, so a resubmitted form returns the
// same analysis instead of creating a second one.

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { AppError } from "../errors";
import { analyses, analysisRequests, analysisSources, products } from "../schema";
import { addImageSource, MAX_IMAGES_PER_UPLOAD } from "./media";
import { getProduct } from "./products";
import { createRequests, type NewRequest } from "./requests";
import { addSource } from "./sources";

export interface QuickStartInput {
  batchKey: string;
  product: { id: string } | { name: string };
  analysis: { title: string; goal?: string };
  requests: NewRequest[];
  sources: { name: string; text: string; kind: "file" | "paste" }[];
  images: { name: string; bytes: Uint8Array }[];
}

export interface QuickStartResult {
  productId: string;
  analysisId: string;
  /** Per-item outcome for sources and screenshots, shown to the user. */
  notes: string[];
}

const derivedId = (prefix: string, batchKey: string) =>
  `${prefix}_${createHash("sha256").update(`${prefix}:${batchKey}`).digest("hex").slice(0, 32)}`;

export async function quickStart(db: Db, dataDir: string, input: QuickStartInput): Promise<QuickStartResult> {
  if (!/^[0-9a-f-]{36}$/.test(input.batchKey)) throw new AppError("invalid_input", "Missing idempotency key");
  const title = input.analysis.title.trim();
  if (!title) throw new AppError("invalid_input", "Give this analysis a title");
  if (!input.requests.length && !input.images.length) throw new AppError("invalid_input", "Paste at least one request or screenshot");
  if (input.images.length > MAX_IMAGES_PER_UPLOAD) throw new AppError("invalid_input", `At most ${MAX_IMAGES_PER_UPLOAD} screenshots at a time`);
  const missingParty = input.requests.findIndex((r) => !r.party.trim());
  if (missingParty !== -1) throw new AppError("invalid_input", `Request ${missingParty + 1} has no party`);

  const analysisId = derivedId("ana", input.batchKey);
  const [done] = await db.select({ productId: analyses.productId }).from(analyses).where(eq(analyses.id, analysisId));
  if (done) return { productId: done.productId, analysisId, notes: [] };

  let productId: string;
  if ("id" in input.product) {
    productId = (await getProduct(db, input.product.id)).id;
  } else {
    const name = input.product.name.trim();
    if (!name) throw new AppError("invalid_input", "Enter a product name");
    productId = derivedId("prod", input.batchKey);
    await db.insert(products).values({ id: productId, name: name.slice(0, 120) }).onConflictDoNothing();
  }

  const notes: string[] = [];
  const versionIds: string[] = [];
  for (const src of input.sources) {
    try {
      const r = await addSource(db, productId, { name: src.name, text: src.text, kind: src.kind });
      versionIds.push(r.versionId);
      notes.push(r.status === "created" ? `Source "${src.name}" saved` : `Source "${src.name}" has the same content as "${r.name}" and was reused`);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      notes.push(`Source "${src.name}" not saved: ${err.message}`);
    }
  }
  for (const img of input.images) {
    try {
      const r = await addImageSource(db, dataDir, productId, img);
      versionIds.push(r.versionId);
      notes.push(r.status === "created" ? `Screenshot "${img.name}" saved` : `Screenshot "${img.name}" is identical to "${r.name}" and was reused`);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      notes.push(`Screenshot "${img.name}" not saved: ${err.message}`);
    }
  }
  const requestIds = input.requests.length ? await createRequests(db, productId, input.batchKey, input.requests) : [];

  await db.transaction(async (tx) => {
    await tx.insert(analyses).values({ id: analysisId, productId, title, goal: input.analysis.goal?.trim() ?? "" });
    if (requestIds.length) {
      await tx.insert(analysisRequests).values(requestIds.map((requestId, position) => ({ productId, analysisId, requestId, position })));
    }
    const unique = [...new Set(versionIds)];
    if (unique.length) await tx.insert(analysisSources).values(unique.map((sourceVersionId) => ({ productId, analysisId, sourceVersionId })));
  });
  return { productId, analysisId, notes };
}
