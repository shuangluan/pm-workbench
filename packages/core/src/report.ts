// Report snapshot, status and programmatic Markdown export (PRD F06 structure, F08).
// No model call happens here: the report is assembled from reviewed claims only.

import type { ClaimRecord, ClaimSection } from "./claims";
import { isTruncated, verificationQuestion, type ImpactResult } from "./graph";
import type { ClaimKind, EvidenceValidity, Lang, SystemEdge, SystemNode } from "./types";

export type CoverageHandling = "shared_capability" | "configuration" | "separate" | "not_covered";

export interface CoverageRow {
  requestHandle: string;
  party: string;
  goal: string;
  shared: string;
  specific: string;
  handling: CoverageHandling;
  evidence: string[];
}

export interface ReportRequest {
  handle: string;
  /** Evidence holding the verbatim text, so a permanent deletion can scrub it from saved snapshots. */
  evidenceId?: string;
  party: string;
  title: string;
  originalText: string;
}

export interface ReportEvidence {
  handle: string;
  evidenceId?: string;
  sourceName: string;
  sourceVersion: number;
  lineStart: number;
  lineEnd: number;
  /** Null once the source was permanently deleted: the placeholder replaces the text (§8.3). */
  quote: string | null;
  validity: EvidenceValidity;
}

export interface ReportDecision {
  text: string;
  reason: string;
  decidedAt: string;
}

export interface ReportSnapshot {
  title: string;
  goal: string;
  changeDescription?: string;
  createdAt: string;
  requests: ReportRequest[];
  sources: { name: string; version: number; validity: EvidenceValidity; sourceVersionId?: string }[];
  coverage: CoverageRow[];
  claims: ClaimRecord[];
  impact?: { result: ImpactResult; nodes: SystemNode[]; edges: SystemEdge[] };
  evidence: ReportEvidence[];
  decisions: ReportDecision[];
  openQuestions: string[];
  model?: { provider: string; model: string };
  templateVersion: string;
}

/** Requests missing from the coverage table. A non-empty result means the abstraction is incomplete (F06). */
export function missingCoverage(coverage: readonly CoverageRow[], requestHandles: readonly string[]): string[] {
  const covered = new Set(coverage.map((r) => r.requestHandle));
  return requestHandles.filter((h) => !covered.has(h));
}

export type ReportStatus = "draft" | "reviewed_open" | "reviewed_clear";

export interface OpenItem {
  kind: "unknown" | "stale_evidence" | "question" | "truncated_impact";
  text: string;
}

export function openItems(snapshot: ReportSnapshot, lang: Lang = "zh"): OpenItem[] {
  const items: OpenItem[] = [];
  for (const c of snapshot.claims) {
    if (c.review === "rejected") continue;
    if (c.kind === "unknown") items.push({ kind: "unknown", text: c.missing ? `${c.text}（${c.missing}）` : c.text });
    if (c.evidenceValidity !== "valid") items.push({ kind: "stale_evidence", text: c.text });
  }
  for (const q of snapshot.openQuestions) items.push({ kind: "question", text: q });
  if (snapshot.impact && isTruncated(snapshot.impact.result)) {
    items.push({ kind: "truncated_impact", text: L[lang].truncated });
  }
  return items;
}

/**
 * "Reviewed" only means every claim was looked at, not that the report is
 * correct or complete. Pending claims keep the report a draft.
 */
export function reportStatus(snapshot: ReportSnapshot): ReportStatus {
  if (snapshot.claims.some((c) => c.review === "pending")) return "draft";
  return openItems(snapshot).length ? "reviewed_open" : "reviewed_clear";
}

const L = {
  zh: {
    status: { draft: "草稿：仍有待核对条目", reviewed_open: "已核对（有未决项）", reviewed_clear: "已核对（无已知未决项）" },
    reviewedNote: "“已核对”仅表示用户检查过所有条目，不保证正确或完整。",
    kind: { source_fact: "原文事实", confirmed_relation: "已确认关系", inference: "推断", suggestion: "建议", unknown: "未知" },
    pending: "待核对",
    corrected: "已修正",
    userInput: "用户输入",
    goal: "任务目标",
    change: "改动描述",
    scope: "输入范围",
    requests: "需求原话",
    sources: "资料",
    coverage: "诉求覆盖",
    coverageHead: ["需求", "业务方", "目标", "共同部分", "特有约束", "处理方式"],
    handling: { shared_capability: "纳入通用能力", configuration: "配置/扩展", separate: "分开处理", not_covered: "未覆盖" },
    sections: {
      common_problem: "共同问题",
      capability: "通用能力建议",
      configuration: "配置与扩展建议",
      conflict: "冲突",
      uncovered: "未覆盖项",
      risk: "风险与未决事项",
      impact_confirmed: "已确认依赖检查",
      impact_possible: "可能影响",
      impact_unknown: "未知与覆盖限制",
      checklist: "检查清单",
      spec: "规格条目",
    } satisfies Record<ClaimSection, string>,
    impact: "影响检查",
    changed: "变更对象",
    direct: "直接依赖",
    indirect: "间接依赖",
    noGraph: "未选择起始节点：未执行已确认依赖检查。",
    noHits: "在已确认关系中未找到依赖该对象的节点。这不代表没有其他影响。",
    truncated: "依赖查询到达深度或数量上限，存在未展开范围。",
    beyond: "超出深度未展开",
    overLimit: "超出数量上限未展开",
    skipped: "未参与传播的关系（未确认、已失效或不可传播类型）",
    verify: "建议验证",
    open: "未决事项",
    none: "（无）",
    decisions: "人工决策",
    reason: "理由",
    index: "来源索引",
    deleted: "［来源已删除，原句不再保留］",
    stale: "待复核",
    sourceDeleted: "来源已删除",
    meta: "生成信息",
    rejected: (n: number) => `另有 ${n} 条结论被标为不采纳，未列入正文。`,
    based: "依据",
    reasoning: "推导",
    missing: "需补充",
    specTitle: "精简规格",
    specSections: ["目标", "范围", "业务规则", "影响检查", "验收建议", "待确认项"],
    empty: "（无已核对内容）",
  },
  en: {
    status: { draft: "Draft: claims still pending review", reviewed_open: "Reviewed (open items remain)", reviewed_clear: "Reviewed (no known open items)" },
    reviewedNote: "\"Reviewed\" only means every claim was checked by the user; it does not guarantee correctness or completeness.",
    kind: { source_fact: "Source fact", confirmed_relation: "Confirmed relation", inference: "Inference", suggestion: "Suggestion", unknown: "Unknown" },
    pending: "Pending review",
    corrected: "Corrected",
    userInput: "User input",
    goal: "Goal",
    change: "Change",
    scope: "Input scope",
    requests: "Requests (verbatim)",
    sources: "Sources",
    coverage: "Request coverage",
    coverageHead: ["Request", "Party", "Goal", "Shared", "Specific constraints", "Handling"],
    handling: { shared_capability: "Shared capability", configuration: "Configuration / extension", separate: "Handle separately", not_covered: "Not covered" },
    sections: {
      common_problem: "Common problem",
      capability: "Shared capability proposal",
      configuration: "Configuration and extensions",
      conflict: "Conflicts",
      uncovered: "Not covered",
      risk: "Risks and open questions",
      impact_confirmed: "Confirmed dependency check",
      impact_possible: "Possible impact",
      impact_unknown: "Unknowns and coverage limits",
      checklist: "Checklist",
      spec: "Spec items",
    } satisfies Record<ClaimSection, string>,
    impact: "Impact check",
    changed: "Changed",
    direct: "Direct dependency",
    indirect: "Indirect dependency",
    noGraph: "No start node selected: the confirmed dependency check was not run.",
    noHits: "No confirmed relation depends on this node. This does not mean there is no other impact.",
    truncated: "The dependency query hit its depth or node limit; part of the graph was not expanded.",
    beyond: "Not expanded (depth limit)",
    overLimit: "Not expanded (node limit)",
    skipped: "Relations not propagated (unconfirmed, invalid or non-propagating type)",
    verify: "Verify",
    open: "Open items",
    none: "(none)",
    decisions: "Decisions",
    reason: "reason",
    index: "Source index",
    deleted: "[source deleted; quote no longer kept]",
    stale: "needs review",
    sourceDeleted: "source deleted",
    meta: "Generation info",
    rejected: (n: number) => `${n} claim(s) marked as rejected are not listed.`,
    based: "based on",
    reasoning: "reasoning",
    missing: "needed",
    specTitle: "Spec summary",
    specSections: ["Goal", "Scope", "Business rules", "Impact check", "Acceptance suggestions", "To confirm"],
    empty: "(no reviewed content)",
  },
} as const;

/** Neutralise HTML and line breaks in untrusted text so exported Markdown cannot carry markup. */
export function escapeInline(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, " ");
}

function cell(text: string): string {
  return escapeInline(text).replace(/\|/g, "\\|");
}

function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${escapeInline(line)}`)
    .join("\n");
}

function claimLine(c: ClaimRecord, lang: Lang): string {
  const t = L[lang];
  const tags: string[] = [t.kind[c.kind]];
  if (c.origin === "user") tags.push(t.userInput);
  if (c.review === "pending") tags.push(t.pending);
  if (c.review === "corrected") tags.push(t.corrected);
  if (c.evidenceValidity === "needs_review") tags.push(t.stale);
  if (c.evidenceValidity === "source_deleted") tags.push(t.sourceDeleted);
  let line = `- **[${tags.join(" · ")}]** ${escapeInline(c.text)}`;
  if (c.evidence.length) line += ` — ${t.based} ${c.evidence.map((e) => `[${e.handle}]`).join(" ")}`;
  if (c.reasoning) line += `\n  - ${t.reasoning}：${escapeInline(c.reasoning)}`;
  if (c.missing) line += `\n  - ${t.missing}：${escapeInline(c.missing)}`;
  return line;
}

function claimsIn(snapshot: ReportSnapshot, section: ClaimSection): ClaimRecord[] {
  return snapshot.claims.filter((c) => c.section === section && c.review !== "rejected");
}

function impactLines(snapshot: ReportSnapshot, lang: Lang): string[] {
  const t = L[lang];
  const out: string[] = [];
  const impact = snapshot.impact;
  if (!impact) return [t.noGraph];
  const nodes = new Map(impact.nodes.map((n) => [n.id, n]));
  const edges = new Map(impact.edges.map((e) => [e.id, e]));
  const name = (id: string) => escapeInline(nodes.get(id)?.name ?? id);
  const { result } = impact;

  out.push(`${t.changed}：${result.changedNodeIds.map(name).join("、")}`, "");
  if (!result.hits.length) out.push(t.noHits);
  for (const hit of result.hits) {
    const route = hit.paths
      .map((p) => p.map((id) => {
        const e = edges.get(id);
        return e ? `${name(e.from)} -${e.type}→ ${name(e.to)}` : id;
      }).join(" ; "))
      .join(" | ");
    out.push(`- **${name(hit.nodeId)}**（${hit.relation === "direct" ? t.direct : t.indirect}，${hit.depth}）：${route}`);
    out.push(`  - ${t.verify}：${escapeInline(verificationQuestion(hit, nodes, edges, lang))}`);
  }
  const { beyondDepthNodeIds, overNodeLimitNodeIds } = result.truncation;
  if (beyondDepthNodeIds.length) out.push(`- ${t.beyond}：${beyondDepthNodeIds.map(name).join("、")}`);
  if (overNodeLimitNodeIds.length) out.push(`- ${t.overLimit}：${overNodeLimitNodeIds.map(name).join("、")}`);
  if (result.skippedEdges.length) {
    out.push(`- ${t.skipped}：`);
    for (const s of result.skippedEdges) {
      const e = edges.get(s.edgeId);
      out.push(`  - ${e ? `${name(e.from)} -${e.type}→ ${name(e.to)}` : s.edgeId}（${s.reason}）`);
    }
  }
  return out;
}

function evidenceIndex(snapshot: ReportSnapshot, lang: Lang): string[] {
  const t = L[lang];
  return snapshot.evidence.map((e) => {
    const where = `${escapeInline(e.sourceName)} v${e.sourceVersion} L${e.lineStart}${e.lineEnd !== e.lineStart ? `–${e.lineEnd}` : ""}`;
    const flag = e.validity === "valid" ? "" : `（${e.validity === "source_deleted" ? t.sourceDeleted : t.stale}）`;
    return `- [${e.handle}] ${where}${flag}：${e.quote === null ? t.deleted : `“${escapeInline(e.quote)}”`}`;
  });
}

export function renderReportMarkdown(snapshot: ReportSnapshot, lang: Lang = "zh"): string {
  const t = L[lang];
  const status = reportStatus(snapshot);
  const open = openItems(snapshot, lang);
  const out: string[] = [`# ${escapeInline(snapshot.title)}`, "", `> **${t.status[status]}**。${t.reviewedNote}`, ""];

  out.push(`## ${t.goal}`, "", escapeInline(snapshot.goal), "");
  if (snapshot.changeDescription) out.push(`**${t.change}**：${escapeInline(snapshot.changeDescription)}`, "");

  out.push(`## ${t.scope}`, "", `### ${t.requests}`, "");
  for (const r of snapshot.requests) out.push(`**${r.handle} · ${escapeInline(r.party)} · ${escapeInline(r.title)}**`, "", quoteBlock(r.originalText), "");
  out.push(`### ${t.sources}`, "");
  for (const s of snapshot.sources) out.push(`- ${escapeInline(s.name)} v${s.version}${s.validity === "valid" ? "" : `（${s.validity === "source_deleted" ? t.sourceDeleted : t.stale}）`}`);
  out.push("");

  if (snapshot.coverage.length) {
    out.push(`## ${t.coverage}`, "", `| ${t.coverageHead.join(" | ")} |`, `|${t.coverageHead.map(() => " --- ").join("|")}|`);
    for (const r of snapshot.coverage) {
      out.push(`| ${r.requestHandle} | ${cell(r.party)} | ${cell(r.goal)} | ${cell(r.shared)} | ${cell(r.specific)} | ${t.handling[r.handling]} |`);
    }
    out.push("");
  }

  for (const section of ["common_problem", "capability", "configuration", "conflict", "uncovered", "risk"] as const) {
    const list = claimsIn(snapshot, section);
    if (list.length) out.push(`## ${t.sections[section]}`, "", ...list.map((c) => claimLine(c, lang)), "");
  }

  if (snapshot.impact || snapshot.claims.some((c) => c.section.startsWith("impact_") || c.section === "checklist")) {
    out.push(`## ${t.impact}`, "", `### ${t.sections.impact_confirmed}`, "", ...impactLines(snapshot, lang), "");
    for (const section of ["impact_confirmed", "impact_possible", "impact_unknown", "checklist"] as const) {
      const list = claimsIn(snapshot, section);
      if (!list.length) continue;
      if (section !== "impact_confirmed") out.push(`### ${t.sections[section]}`, "");
      out.push(...list.map((c) => claimLine(c, lang)), "");
    }
  }

  out.push(`## ${t.open}`, "", ...(open.length ? open.map((o) => `- ${escapeInline(o.text)}`) : [t.none]), "");

  out.push(`## ${t.decisions}`, "");
  if (snapshot.decisions.length) {
    for (const d of snapshot.decisions) out.push(`- ${escapeInline(d.text)}（${t.reason}：${escapeInline(d.reason)}；${d.decidedAt}）`);
  } else out.push(t.none);
  out.push("");

  const rejected = snapshot.claims.filter((c) => c.review === "rejected").length;
  if (rejected) out.push(`_${t.rejected(rejected)}_`, "");

  out.push(`## ${t.index}`, "", ...(snapshot.evidence.length ? evidenceIndex(snapshot, lang) : [t.none]), "");
  out.push(
    `## ${t.meta}`,
    "",
    `- ${snapshot.createdAt}`,
    `- template ${snapshot.templateVersion}`,
    snapshot.model ? `- ${escapeInline(snapshot.model.provider)} / ${escapeInline(snapshot.model.model)}` : "- manual",
    "",
  );
  return out.join("\n");
}

/**
 * Spec summary assembled from reviewed claims only (F08). Gaps stay visible
 * rather than being filled, and open items are never dropped.
 */
export function renderSpecMarkdown(snapshot: ReportSnapshot, lang: Lang = "zh"): string {
  const t = L[lang];
  const reviewed = (sections: ClaimSection[], kinds?: ClaimKind[]) =>
    snapshot.claims.filter(
      (c) => (c.review === "accepted" || c.review === "corrected") && sections.includes(c.section) && (!kinds || kinds.includes(c.kind)),
    );
  const block = (title: string, lines: string[]) => [`## ${title}`, "", ...(lines.length ? lines : [t.empty]), ""];
  const [goal, scope, rules, impact, acceptance, toConfirm] = t.specSections;

  return [
    `# ${escapeInline(snapshot.title)} · ${t.specTitle}`,
    "",
    `> **${t.status[reportStatus(snapshot)]}**`,
    "",
    ...block(goal, [escapeInline(snapshot.goal)]),
    ...block(scope, [
      ...reviewed(["capability", "configuration"]).map((c) => claimLine(c, lang)),
      ...snapshot.coverage.filter((r) => r.handling === "separate" || r.handling === "not_covered").map((r) => `- ${r.requestHandle}：${t.handling[r.handling]}`),
    ]),
    ...block(rules, reviewed(["spec", "conflict", "common_problem"], ["source_fact", "confirmed_relation"]).map((c) => claimLine(c, lang))),
    ...block(impact, [...impactLines(snapshot, lang), ...reviewed(["impact_confirmed", "impact_possible"]).map((c) => claimLine(c, lang))]),
    ...block(acceptance, reviewed(["checklist"]).map((c) => claimLine(c, lang))),
    ...block(toConfirm, openItems(snapshot, lang).map((o) => `- ${escapeInline(o.text)}`)),
    `## ${t.index}`,
    "",
    ...evidenceIndex(snapshot, lang),
    "",
  ].join("\n");
}
