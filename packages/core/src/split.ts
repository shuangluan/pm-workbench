// Rule-based request splitting for pasted text and tables (PRD F03 without a
// model). Output is a preview the user edits and confirms; nothing is created
// from it automatically. The model-based split (M2) produces the same shape.

import { normalizeText } from "./text";

export interface SplitCandidate {
  party: string | null;
  title: string | null;
  text: string;
}

export type SplitMode = "table" | "speaker" | "list" | "paragraph";

export interface SplitResult {
  mode: SplitMode;
  candidates: SplitCandidate[];
  /** Columns recognised in table mode, for showing the mapping to the user. */
  columns?: { party: number | null; title: number | null; text: number };
  truncated: boolean;
}

export const MAX_SPLIT_CANDIDATES = 50;

const PARTY_HEADER = /^(业务方|业务线|提出方|提出人|需求方|部门|团队|客户|角色|party|from|requester|team)$/i;
const TEXT_HEADER = /^(原话|原文|需求|需求描述|描述|内容|诉求|问题|反馈|text|request|description|content)$/i;
const TITLE_HEADER = /^(标题|主题|摘要|需求名称|名称|title|summary|subject)$/i;

function clean(s: string): string {
  return s.replace(/[ \t]+$/gm, "").trim();
}

function cap(candidates: SplitCandidate[]): Pick<SplitResult, "candidates" | "truncated"> {
  const kept = candidates.filter((c) => c.text.trim() !== "");
  return { candidates: kept.slice(0, MAX_SPLIT_CANDIDATES), truncated: kept.length > MAX_SPLIT_CANDIDATES };
}

/** RFC 4180-style CSV: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(raw: string): string[][] {
  const text = normalizeText(raw);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Rows from a spreadsheet (pasted TSV or uploaded CSV). A header row is recognised by column names. */
export function splitTable(rows: string[][]): SplitResult {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const header = rows[0]?.map((c) => c.trim()) ?? [];
  const find = (re: RegExp) => {
    const i = header.findIndex((h) => re.test(h));
    return i === -1 ? null : i;
  };
  let party = find(PARTY_HEADER);
  let title = find(TITLE_HEADER);
  let text = find(TEXT_HEADER);
  const hasHeader = party !== null || title !== null || text !== null;
  if (!hasHeader) {
    // No header: two columns read as party + text, otherwise the last column is the text.
    party = width >= 2 ? 0 : null;
    title = width >= 3 ? 1 : null;
    text = width - 1;
  } else if (text === null) {
    // Header without a text column: use the widest remaining column.
    const used = new Set([party, title]);
    const candidates = [...Array(width).keys()].filter((i) => !used.has(i));
    text = candidates.sort((a, b) => avgLen(rows, b) - avgLen(rows, a))[0] ?? width - 1;
  }
  const body = hasHeader ? rows.slice(1) : rows;
  const cell = (r: string[], i: number | null) => (i === null ? null : clean(r[i] ?? "") || null);
  return {
    mode: "table",
    columns: { party, title, text: text! },
    ...cap(body.map((r) => ({ party: cell(r, party), title: cell(r, title), text: cell(r, text!) ?? "" }))),
  };
}

function avgLen(rows: string[][], col: number): number {
  return rows.reduce((n, r) => n + (r[col]?.length ?? 0), 0) / Math.max(1, rows.length);
}

// "运营：……" / "张三(销售): ……"
const PREFIX = /^\s*([^\s：:，。,.!?！？]{1,16}(?:[（(][^）)]{1,12}[）)])?)\s*[：:]\s*(\S[\s\S]*)$/;
// Chat exports: "张三 10:32", "张三 2026-11-01 10:32:05", "张三  昨天 18:20"
const CHAT_HEADER = /^\s*(\S.{0,29}?)\s+(?:(?:\d{4}[-/.年])?\d{1,2}[-/.月]\d{1,2}日?\s+|昨天\s+|今天\s+|星期.\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*$/;
// "1. " and "1) " need a space (so "1.5倍" is not a list); "2、" and "（3）" often have none.
const BULLET = /^\s*(?:\d{1,3}[.)）]\s+|\d{1,3}、\s*|[-*•·]\s+|[（(]\d{1,3}[）)]\s*)/;

// The person pasting the chat ("我") is usually the PM asking a clarifying question.
const SELF = /^(我|me|自己|本人)$/i;

/**
 * Fold the PM's own questions, and the answer that follows from the same
 * party, into that party's request, so a clarification stays with what it clarifies.
 */
function foldClarifications(items: SplitCandidate[]): SplitCandidate[] {
  const out: SplitCandidate[] = [];
  let labelled = false;
  let afterSelf = false;
  const append = (target: SplitCandidate, c: SplitCandidate) => {
    if (!labelled) target.text = `${target.party ?? ""}：${target.text}`;
    labelled = true;
    target.text += `\n${c.party ?? ""}：${c.text}`;
  };
  for (const c of items) {
    const last = out[out.length - 1];
    if (last && c.party && SELF.test(c.party)) {
      append(last, c);
      afterSelf = true;
    } else if (last && afterSelf && c.party === last.party) {
      append(last, c);
      afterSelf = false;
    } else {
      out.push({ ...c });
      labelled = false;
      afterSelf = false;
    }
  }
  return out;
}

function partyPrefix(text: string): { party: string | null; text: string } {
  const m = PREFIX.exec(text);
  return m ? { party: m[1]!, text: clean(m[2]!) } : { party: null, text: clean(text) };
}

export function splitRequests(raw: string): SplitResult {
  const text = normalizeText(raw);
  const lines = text.split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "");

  // 1. Spreadsheet paste: most lines tab-separated with the same column count.
  const tabbed = nonEmpty.filter((l) => l.includes("\t"));
  if (nonEmpty.length >= 1 && tabbed.length >= Math.max(1, Math.ceil(nonEmpty.length * 0.8))) {
    const counts = new Map<number, number>();
    for (const l of tabbed) counts.set(l.split("\t").length, (counts.get(l.split("\t").length) ?? 0) + 1);
    const [width] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (width >= 2) return splitTable(nonEmpty.map((l) => l.split("\t")));
  }

  // 2. Chat export: speaker header lines followed by message lines.
  const headers = lines.filter((l) => CHAT_HEADER.test(l)).length;
  if (headers >= 2) {
    const out: SplitCandidate[] = [];
    let speaker: string | null = null;
    let buf: string[] = [];
    const flush = () => {
      const body = clean(buf.join("\n"));
      if (body) {
        const last = out[out.length - 1];
        // Consecutive messages from one speaker usually form one request.
        if (last && last.party === speaker) last.text = `${last.text}\n${body}`;
        else out.push({ party: speaker, title: null, text: body });
      }
      buf = [];
    };
    for (const line of lines) {
      const m = CHAT_HEADER.exec(line);
      if (m) {
        flush();
        speaker = m[1]!.trim();
      } else buf.push(line);
    }
    flush();
    return { mode: "speaker", ...cap(foldClarifications(out)) };
  }

  // 3. "业务方：原话" lines.
  const prefixed = nonEmpty.filter((l) => PREFIX.test(l)).length;
  if (prefixed >= 2 && prefixed >= nonEmpty.length * 0.5) {
    const out: SplitCandidate[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const m = PREFIX.exec(line);
      if (m) out.push({ party: m[1]!, title: null, text: clean(m[2]!) });
      else if (out.length) out[out.length - 1]!.text += `\n${line.trim()}`;
      else out.push({ party: null, title: null, text: line.trim() });
    }
    return { mode: "speaker", ...cap(foldClarifications(out)) };
  }

  // 4. Numbered or bulleted list.
  if (nonEmpty.filter((l) => BULLET.test(l)).length >= 2) {
    const items: string[] = [];
    for (const line of lines) {
      if (BULLET.test(line)) items.push(line.replace(BULLET, ""));
      else if (line.trim() && items.length) items[items.length - 1] += `\n${line.trim()}`;
    }
    return { mode: "list", ...cap(items.map((t) => ({ title: null, ...partyPrefix(t) }))) };
  }

  // 5. Paragraphs separated by blank lines.
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return { mode: "paragraph", ...cap(paragraphs.map((p) => ({ title: null, ...partyPrefix(p) }))) };
}
