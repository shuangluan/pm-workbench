// Screenshot sources and their transcripts.
//
// An image is stored as an original file under <dataDir>/files/ with a
// server-generated name; the database keeps its hash, sniffed type and size.
// Text read from an image (by the user now, by a vision model later) is a
// separate `transcript` source linked to the image version it came from, so a
// citation into the transcript never pretends to be the screenshot itself.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { charCount } from "@pew/core";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { AppError, newId, notFound } from "../errors";
import { sourceVersions, sources } from "../schema";
import { touchProduct } from "./products";
import { ingestOrThrow, supersedeVersions } from "./sources";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_UPLOAD = 20;

export type ImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
const EXT: Record<ImageType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Type from magic bytes only. SVG and anything else is refused: it can carry script. */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length >= 6 && String.fromCharCode(...b.slice(0, 4)) === "GIF8") return "image/gif";
  return null;
}

export const sha256Bytes = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const STORAGE_KEY = /^files\/[a-z0-9_]+\/[a-z0-9_]+\.(png|jpg|webp|gif)$/;

export function storagePath(dataDir: string, storageKey: string): string {
  if (!STORAGE_KEY.test(storageKey)) throw new AppError("invalid_input", "无效的文件位置");
  return join(dataDir, storageKey);
}

export function writeStoredFile(dataDir: string, productId: string, versionId: string, type: ImageType, bytes: Uint8Array): string {
  const key = `files/${productId}/${versionId}.${EXT[type]}`;
  const path = storagePath(dataDir, key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { mode: 0o600 });
  return key;
}

export function removeStoredFile(dataDir: string, storageKey: string | null) {
  if (storageKey) rmSync(storagePath(dataDir, storageKey), { force: true });
}

export type AddImageResult =
  | { status: "created"; sourceId: string; versionId: string }
  | { status: "duplicate"; sourceId: string; versionId: string; name: string };

export async function addImageSource(db: Db, dataDir: string, productId: string, input: { name: string; bytes: Uint8Array }): Promise<AddImageResult> {
  if (input.bytes.byteLength === 0) throw new AppError("invalid_input", "图片为空");
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) throw new AppError("invalid_input", "图片超过 10 MB");
  const type = sniffImage(input.bytes);
  if (!type) throw new AppError("invalid_input", "只支持 PNG、JPEG、WebP、GIF 图片");
  const hash = sha256Bytes(input.bytes);

  const [dup] = await db
    .select({ sourceId: sources.id, versionId: sourceVersions.id, name: sources.name })
    .from(sourceVersions)
    .innerJoin(sources, eq(sources.id, sourceVersions.sourceId))
    .where(and(eq(sourceVersions.productId, productId), eq(sourceVersions.contentHash, hash), eq(sourceVersions.validity, "valid"), eq(sources.kind, "image")));
  if (dup) return { status: "duplicate", ...dup };

  const name = input.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "截图";
  const sourceId = newId("src");
  const versionId = newId("sv");
  const storageKey = writeStoredFile(dataDir, productId, versionId, type, input.bytes);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(sources).values({ id: sourceId, productId, kind: "image", name });
      await tx.insert(sourceVersions).values({
        id: versionId,
        productId,
        sourceId,
        version: 1,
        text: null,
        contentHash: hash,
        charCount: 0,
        storageKey,
        mediaType: type,
        byteSize: input.bytes.byteLength,
      });
    });
  } catch (err) {
    removeStoredFile(dataDir, storageKey);
    throw err;
  }
  await touchProduct(db, productId);
  return { status: "created", sourceId, versionId };
}

/** Bytes of a stored image, after checking it belongs to the product. */
export async function readImage(db: Db, dataDir: string, productId: string, versionId: string) {
  const [v] = await db
    .select()
    .from(sourceVersions)
    .where(and(eq(sourceVersions.productId, productId), eq(sourceVersions.id, versionId)));
  if (!v || !v.storageKey || !v.mediaType) throw notFound("图片");
  return { bytes: readFileSync(storagePath(dataDir, v.storageKey)), mediaType: v.mediaType as ImageType };
}

/** The transcript source for an image version, if one exists. */
export async function findTranscript(db: Db, productId: string, imageVersionId: string) {
  const [row] = await db
    .select({ sourceId: sourceVersions.sourceId, versionId: sourceVersions.id, text: sourceVersions.text, transcribedBy: sourceVersions.transcribedBy, version: sourceVersions.version })
    .from(sourceVersions)
    .where(and(eq(sourceVersions.productId, productId), eq(sourceVersions.derivedFromVersionId, imageVersionId), eq(sourceVersions.validity, "valid")))
    .orderBy(desc(sourceVersions.version));
  return row ?? null;
}

/**
 * Save text read from a screenshot. A second transcript of the same image
 * becomes a new version, so citations into the earlier text stay intact.
 */
export async function saveTranscript(db: Db, productId: string, imageVersionId: string, text: string, by: "user" | "model" = "user") {
  const [image] = await db
    .select({ v: sourceVersions, name: sources.name, kind: sources.kind })
    .from(sourceVersions)
    .innerJoin(sources, eq(sources.id, sourceVersions.sourceId))
    .where(and(eq(sourceVersions.productId, productId), eq(sourceVersions.id, imageVersionId)));
  if (!image || image.kind !== "image") throw notFound("截图");
  if (image.v.validity !== "valid") throw new AppError("invalid_input", "只能转写当前有效的截图");
  const ingested = ingestOrThrow(text);
  const existing = await findTranscript(db, productId, imageVersionId);
  if (existing?.text === ingested.text) return { sourceId: existing.sourceId, versionId: existing.versionId, status: "unchanged" as const };

  const sourceId = existing?.sourceId ?? newId("src");
  const versionId = newId("sv");
  await db.transaction(async (tx) => {
    if (existing) await supersedeVersions(tx, productId, sourceId);
    else await tx.insert(sources).values({ id: sourceId, productId, kind: "transcript", name: `${image.name}（转写）` });
    await tx.insert(sourceVersions).values({
      id: versionId,
      productId,
      sourceId,
      version: (existing?.version ?? 0) + 1,
      text: ingested.text,
      contentHash: ingested.hash,
      charCount: charCount(ingested.text),
      derivedFromVersionId: imageVersionId,
      transcribedBy: by,
    });
  });
  await touchProduct(db, productId);
  return { sourceId, versionId, status: "created" as const };
}
