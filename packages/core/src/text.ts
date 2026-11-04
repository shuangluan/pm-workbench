// Dependency-free text helpers, safe to import in the browser.

/** Strip BOM, unify line endings and Unicode composition so offsets are stable. */
export function normalizeText(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").normalize("NFC");
}

/** Counts code points, which is what a user means by "characters". */
export function charCount(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}
