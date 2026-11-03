// Synthetic standard example: batch export (PRD §10.3).
// Fictional company and data. Evidence offsets are computed from the source
// text, never typed by hand, so the example doubles as a fixture.

import {
  EvidenceRegistry,
  findQuote,
  impactQuery,
  ingestText,
  makeEvidence,
  type ClaimDraft,
  type ClaimRecord,
  type CoverageRow,
  type Evidence,
  type ReportSnapshot,
  type SourceVersionText,
  type SystemEdge,
  type SystemNode,
} from "@pew/core";

export const PRODUCT_ID = "prod_example_crm";
export const EXAMPLE_LABEL = "示例 · 合成数据";

const SOURCE_TEXT = {
  permission: `# 权限规则说明

## 客户可见范围

普通成员只能访问自己的客户。
团队负责人可访问团队客户。
`,
  export: `# 导出规则

当前只有同步CSV导出。
资料未说明大数据量限制。
`,
  data: `# 客户数据说明

## 受限字段

手机号属于受限字段。
`,
};

function version(id: string, raw: string): SourceVersionText {
  const ingested = ingestText(raw);
  if (!ingested.ok) throw new Error(`example source ${id} failed ingestion: ${ingested.code}`);
  return { id, productId: PRODUCT_ID, text: ingested.text, validity: "valid" };
}

export const sources = [
  { name: "权限规则说明", version: 1, sv: version("sv_permission_v1", SOURCE_TEXT.permission) },
  { name: "导出规则", version: 1, sv: version("sv_export_v1", SOURCE_TEXT.export) },
  { name: "客户数据说明", version: 1, sv: version("sv_data_v1", SOURCE_TEXT.data) },
];

function cite(id: string, sv: SourceVersionText, quote: string): Evidence {
  const [span, ...more] = findQuote(sv.text, quote);
  if (!span || more.length) throw new Error(`example quote must occur exactly once: ${quote}`);
  return makeEvidence(id, sv, span);
}

const [perm, exp, data] = sources.map((s) => s.sv) as [SourceVersionText, SourceVersionText, SourceVersionText];

export const evidence: Evidence[] = [
  cite("ev_member_own", perm, "普通成员只能访问自己的客户。"),
  cite("ev_lead_team", perm, "团队负责人可访问团队客户。"),
  cite("ev_sync_csv", exp, "当前只有同步CSV导出。"),
  cite("ev_no_volume", exp, "资料未说明大数据量限制。"),
  cite("ev_phone_restricted", data, "手机号属于受限字段。"),
];

export const registry = new EvidenceRegistry(evidence.map((e) => ({ evidence: e, validity: "valid" })));
export const handleOf = (evidenceId: string) => registry.entries().find((e) => e.evidenceId === evidenceId)!.handle;

export const requests = [
  { handle: "R1", party: "运营", title: "导出当前筛选结果", originalText: "导出当前筛选结果，供每周处理；只需自己有权查看的客户。" },
  { handle: "R2", party: "销售", title: "导出团队客户", originalText: "导出整个团队的客户，用于季度跟进。" },
  { handle: "R3", party: "客服", title: "导出工单关联客户", originalText: "导出当前工单关联客户，但不得包含手机号。" },
];

export const nodes: SystemNode[] = [
  { id: "n_export", productId: PRODUCT_ID, type: "module", name: "导出模块" },
  { id: "n_permission", productId: PRODUCT_ID, type: "module", name: "权限服务" },
  { id: "n_customer", productId: PRODUCT_ID, type: "data_object", name: "客户数据" },
  { id: "n_report", productId: PRODUCT_ID, type: "module", name: "报表模块" },
];

const confirmed = { productId: PRODUCT_ID, confirmation: "confirmed", validity: "valid", basis: "user_asserted", confirmedAt: "2026-11-01" } as const;

export const edges: SystemEdge[] = [
  { id: "e_export_calls_perm", from: "n_export", to: "n_permission", type: "calls", ...confirmed },
  { id: "e_export_reads_customer", from: "n_export", to: "n_customer", type: "reads", ...confirmed },
  { id: "e_report_depends_export", from: "n_report", to: "n_export", type: "depends_on", ...confirmed },
];

const h = handleOf;

/** Preset model output for the abstraction step, as the validator would receive it. */
export const abstractionDrafts: ClaimDraft[] = [
  {
    section: "common_problem",
    kind: "inference",
    text: "三方都需要把一组客户按各自范围导出为文件，用于线下跟进。",
    evidence: [{ handle: h("ev_sync_csv") }],
    reasoning: "R1、R2、R3 都要求导出客户列表，差异在于选取范围和字段。",
    requestHandles: ["R1", "R2", "R3"],
  },
  {
    section: "capability",
    kind: "suggestion",
    text: "建议提供统一的导出入口：导出范围 = 当前筛选/工单关联/团队，字段由可见字段集决定。该方案为设计提议，不是现有能力。",
    evidence: [{ handle: h("ev_sync_csv") }],
    reasoning: "现有只有同步CSV导出，三方差异集中在范围与字段。",
    requestHandles: ["R1", "R2", "R3"],
  },
  {
    section: "conflict",
    kind: "source_fact",
    text: "销售要求导出整个团队的客户，但普通成员只能访问自己的客户；只有团队负责人可访问团队客户。请求者角色待确认，不能默认所有销售获得团队权限。",
    evidence: [{ handle: h("ev_member_own") }, { handle: h("ev_lead_team") }],
    requestHandles: ["R2"],
  },
  {
    section: "conflict",
    kind: "source_fact",
    text: "客服导出不得包含手机号，手机号属于受限字段。该限制必须保留在通用方案中，不能变成可随意关闭的配置项。",
    evidence: [{ handle: h("ev_phone_restricted") }],
    requestHandles: ["R3"],
  },
  {
    section: "risk",
    kind: "unknown",
    text: "大数据量导出的容量与是否需要异步导出无法判断。",
    evidence: [{ handle: h("ev_no_volume") }],
    missing: "需要导出模块负责人提供当前同步导出的行数/耗时上限。",
  },
];

export const coverage: CoverageRow[] = [
  { requestHandle: "R1", party: "运营", goal: "每周处理筛选结果", shared: "按范围导出客户", specific: "仅本人有权查看的客户", handling: "shared_capability", evidence: [h("ev_member_own")] },
  { requestHandle: "R2", party: "销售", goal: "季度跟进团队客户", shared: "按范围导出客户", specific: "团队范围，依赖请求者是否为团队负责人", handling: "configuration", evidence: [h("ev_lead_team")] },
  { requestHandle: "R3", party: "客服", goal: "处理工单关联客户", shared: "按范围导出客户", specific: "不得包含手机号", handling: "shared_capability", evidence: [h("ev_phone_restricted")] },
];

export function toRecords(drafts: ClaimDraft[], review: ClaimRecord["review"] = "pending"): ClaimRecord[] {
  return drafts.map((d, i) => ({ ...d, id: `cl_${i + 1}`, review, revision: 0, evidenceValidity: "valid" }));
}

export function exampleSnapshot(changedNodeIds: string[] = ["n_permission"]): ReportSnapshot {
  return {
    title: `统一批量导出能力（${EXAMPLE_LABEL}）`,
    goal: "判断三方导出诉求能否归入一个通用导出能力，并检查权限服务变更的影响。",
    changeDescription: "调整权限服务的客户可见范围判定。",
    createdAt: "2026-11-01T00:00:00.000Z",
    requests,
    sources: sources.map((s) => ({ name: s.name, version: s.version, validity: s.sv.validity })),
    coverage,
    claims: toRecords(abstractionDrafts, "accepted"),
    impact: { result: impactQuery(nodes, edges, changedNodeIds), nodes, edges },
    evidence: registry.entries().map((r) => {
      const ev = evidence.find((e) => e.id === r.evidenceId)!;
      const src = sources.find((s) => s.sv.id === ev.sourceVersionId)!;
      return { handle: r.handle, sourceName: src.name, sourceVersion: src.version, lineStart: ev.lineStart, lineEnd: ev.lineEnd, quote: ev.quote, validity: r.validity };
    }),
    decisions: [],
    openQuestions: ["销售提出者是否为团队负责人？"],
    templateVersion: "report-v0.1",
  };
}
