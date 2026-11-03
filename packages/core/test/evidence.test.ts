import { describe, expect, it } from "vitest";
import {
  chunkText,
  findQuote,
  ingestBytes,
  ingestText,
  locate,
  makeEvidence,
  MAX_FILE_BYTES,
  MAX_SOURCE_CHARS,
  verifyEvidence,
  type SourceVersionText,
} from "@pew/core";
import { evidence, sources } from "../../../examples/batch-export";

const sv = (text: string, extra: Partial<SourceVersionText> = {}): SourceVersionText => ({
  id: "sv1",
  productId: "p1",
  text,
  validity: "valid",
  ...extra,
});

describe("ingestion", () => {
  it("normalizes BOM and CRLF so offsets are stable", () => {
    const r = ingestText("﻿a\r\nb\rc");
    expect(r).toMatchObject({ ok: true, text: "a\nb\nc" });
  });

  it("rejects empty, oversize, too-long and non-UTF-8 input with distinct codes", () => {
    expect(ingestText("  \n ")).toMatchObject({ ok: false, code: "empty" });
    expect(ingestBytes(new Uint8Array(MAX_FILE_BYTES + 1))).toMatchObject({ ok: false, code: "too_large" });
    expect(ingestText("字".repeat(MAX_SOURCE_CHARS + 1))).toMatchObject({ ok: false, code: "too_many_chars" });
    // "中文" in GBK is not valid UTF-8.
    expect(ingestBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toMatchObject({ ok: false, code: "invalid_encoding" });
  });

  it("counts characters by code point", () => {
    expect(ingestText("😀".repeat(MAX_SOURCE_CHARS))).toMatchObject({ ok: true, chars: MAX_SOURCE_CHARS });
  });

  it("gives identical content an identical hash", () => {
    const a = ingestText("同一内容\n");
    const b = ingestText("同一内容\r\n");
    expect(a.ok && b.ok && a.hash === b.hash).toBe(true);
  });
});

describe("evidence location", () => {
  it("every example citation resolves to its quote and line in the right version", () => {
    for (const ev of evidence) {
      const src = sources.find((s) => s.sv.id === ev.sourceVersionId)!;
      expect(verifyEvidence(ev, src.sv)).toEqual({ ok: true });
      expect(src.sv.text.split("\n")[ev.lineStart - 1]).toContain(ev.quote);
    }
  });

  it("detects a citation moved to another version or product", () => {
    const v1 = sv("权限：仅本人。\n");
    const ev = makeEvidence("e1", v1, findQuote(v1.text, "仅本人")[0]!);
    expect(verifyEvidence(ev, { ...v1, id: "sv2", text: "权限：团队。\n" })).toEqual({ ok: false, code: "version_mismatch" });
    expect(verifyEvidence(ev, { ...v1, productId: "p2" })).toEqual({ ok: false, code: "product_mismatch" });
    expect(verifyEvidence(ev, { ...v1, text: "权限：仅团队。\n" })).toEqual({ ok: false, code: "quote_mismatch" });
    expect(verifyEvidence(ev, { ...v1, validity: "source_deleted" })).toEqual({ ok: false, code: "source_not_current" });
  });

  it("rejects impossible spans", () => {
    expect(() => locate("abc", { start: 2, end: 2 })).toThrow(RangeError);
    expect(() => locate("abc", { start: 0, end: 4 })).toThrow(RangeError);
  });

  it("finds every occurrence so ambiguity is visible", () => {
    expect(findQuote("ab ab", "ab")).toEqual([{ start: 0, end: 2 }, { start: 3, end: 5 }]);
  });

  it("reports multi-line spans with both line numbers", () => {
    expect(locate("a\nbc\nd", { start: 2, end: 6 })).toMatchObject({ lineStart: 2, lineEnd: 3 });
  });
});

describe("chunkText", () => {
  it("splits on headings and blank lines with exact offsets and heading trail", () => {
    const text = "# 权限\n\n## 范围\n\n普通成员只能访问自己的客户。\n团队负责人可访问团队客户。\n\n# 导出\n同步CSV。";
    const chunks = chunkText(text);
    const bodies = chunks.map((c) => [text.slice(c.start, c.end), c.headings.join(">")]);
    expect(bodies).toEqual([
      ["# 权限", "权限"],
      ["## 范围", "权限>范围"],
      ["普通成员只能访问自己的客户。\n团队负责人可访问团队客户。", "权限>范围"],
      ["# 导出", "导出"],
      ["同步CSV。", "导出"],
    ]);
  });
});
