// Source text ingestion and evidence location (PRD §3.3, F04).
//
// Offsets are UTF-16 code unit offsets into the *normalized* text of one
// SourceVersion, which is what JavaScript strings index by. Line numbers are
// 1-based. Nothing here invents PDF page numbers.

import { createHash } from "node:crypto";
import { charCount, normalizeText } from "./text";
import type { EvidenceValidity } from "./types";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_CHARS = 100_000;
export const MAX_FILES_PER_UPLOAD = 10;
export const MAX_REQUEST_PASTE_CHARS = 20_000;

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export { charCount, normalizeText } from "./text";

export type IngestResult =
  | { ok: true; text: string; hash: string; chars: number }
  | { ok: false; code: "empty" | "too_large" | "invalid_encoding" | "too_many_chars"; detail?: string };

/** Decode an uploaded TXT/Markdown file. Non-UTF-8 input is rejected, never guessed. */
export function ingestBytes(bytes: Uint8Array): IngestResult {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return { ok: false, code: "too_large", detail: `${bytes.byteLength} > ${MAX_FILE_BYTES} bytes` };
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "invalid_encoding", detail: "convert the file to UTF-8 and upload again" };
  }
  return ingestText(decoded);
}

export function ingestText(raw: string): IngestResult {
  const text = normalizeText(raw);
  if (text.trim() === "") return { ok: false, code: "empty" };
  const chars = charCount(text);
  if (chars > MAX_SOURCE_CHARS) {
    return { ok: false, code: "too_many_chars", detail: `${chars} > ${MAX_SOURCE_CHARS} characters` };
  }
  return { ok: true, text, hash: sha256(text), chars };
}

export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** 1-based line containing `offset`. */
export function lineAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export interface Span {
  start: number;
  end: number;
}

export interface Located extends Span {
  lineStart: number;
  lineEnd: number;
  quote: string;
}

export function locate(text: string, span: Span, starts = lineStarts(text)): Located {
  const { start, end } = span;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start >= end) {
    throw new RangeError(`invalid span [${start}, ${end}) for text of length ${text.length}`);
  }
  return {
    start,
    end,
    lineStart: lineAt(starts, start),
    lineEnd: lineAt(starts, end - 1),
    quote: text.slice(start, end),
  };
}

/** All exact occurrences of `quote`; the caller decides what to do with ambiguity. */
export function findQuote(text: string, quote: string): Span[] {
  const needle = normalizeText(quote);
  if (needle === "") return [];
  const hits: Span[] = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    hits.push({ start: i, end: i + needle.length });
  }
  return hits;
}

export interface SourceVersionText {
  id: string;
  productId: string;
  text: string;
  validity: EvidenceValidity;
}

export interface Evidence extends Located {
  id: string;
  productId: string;
  sourceVersionId: string;
  hash: string;
}

export function makeEvidence(id: string, version: SourceVersionText, span: Span): Evidence {
  const located = locate(version.text, span);
  return {
    id,
    productId: version.productId,
    sourceVersionId: version.id,
    ...located,
    hash: sha256(located.quote),
  };
}

export type EvidenceCheck =
  | { ok: true }
  | { ok: false; code: "product_mismatch" | "version_mismatch" | "out_of_range" | "quote_mismatch" | "source_not_current" };

/** Proves the citation is real. It does NOT prove the citation supports a claim (§3.3 rule 3). */
export function verifyEvidence(evidence: Evidence, version: SourceVersionText): EvidenceCheck {
  if (evidence.productId !== version.productId) return { ok: false, code: "product_mismatch" };
  if (evidence.sourceVersionId !== version.id) return { ok: false, code: "version_mismatch" };
  if (evidence.end > version.text.length || evidence.start < 0) return { ok: false, code: "out_of_range" };
  const actual = version.text.slice(evidence.start, evidence.end);
  if (actual !== evidence.quote || sha256(actual) !== evidence.hash) return { ok: false, code: "quote_mismatch" };
  if (version.validity !== "valid") return { ok: false, code: "source_not_current" };
  return { ok: true };
}

/** Quote plus surrounding text for the evidence panel highlight. */
export function contextWindow(text: string, span: Span, radius = 160): { before: string; quote: string; after: string } {
  return {
    before: text.slice(Math.max(0, span.start - radius), span.start),
    quote: text.slice(span.start, span.end),
    after: text.slice(span.end, span.end + radius),
  };
}

export interface Chunk extends Span {
  /** Markdown heading trail, outermost first. Empty for text before any heading. */
  headings: string[];
}

/**
 * Split on Markdown headings and blank lines. Chunks keep exact offsets into the
 * normalized text so any chunk can be turned into evidence without re-searching.
 */
export function chunkText(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  const trail: { level: number; title: string }[] = [];
  let paraStart = -1;
  let offset = 0;

  const flush = (end: number) => {
    if (paraStart === -1) return;
    let e = end;
    while (e > paraStart && /\s/.test(text[e - 1]!)) e--;
    if (e > paraStart) chunks.push({ start: paraStart, end: e, headings: trail.map((h) => h.title) });
    paraStart = -1;
  };

  for (const line of text.split("\n")) {
    const lineEnd = offset + line.length;
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush(offset);
      const level = heading[1]!.length;
      while (trail.length && trail[trail.length - 1]!.level >= level) trail.pop();
      trail.push({ level, title: heading[2]! });
      chunks.push({ start: offset, end: lineEnd, headings: trail.map((h) => h.title) });
    } else if (line.trim() === "") {
      flush(offset);
    } else if (paraStart === -1) {
      paraStart = offset + (line.length - line.trimStart().length);
    }
    offset = lineEnd + 1;
  }
  flush(text.length);
  return chunks;
}
