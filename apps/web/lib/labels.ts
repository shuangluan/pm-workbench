import type { ClaimKind, ClaimSection, RejectReason, ReviewStatus } from "@pew/core";

export const KIND: Record<ClaimKind, string> = {
  source_fact: "原文事实",
  confirmed_relation: "已确认关系",
  inference: "推断",
  suggestion: "建议",
  unknown: "未知",
};

export const KIND_HELP: Record<ClaimKind, string> = {
  source_fact: "资料原文写明的内容，必须带引用",
  confirmed_relation: "已确认的节点关系",
  inference: "从资料推导，需要理由和引用",
  suggestion: "方案或检查动作，需要理由",
  unknown: "资料缺失，说明缺什么、找谁补",
};

export const REVIEW: Record<ReviewStatus, string> = {
  pending: "待核对",
  accepted: "已接受",
  corrected: "已修正",
  rejected: "不采纳",
};

export const SECTION: Record<ClaimSection, string> = {
  common_problem: "共同问题",
  capability: "通用能力建议",
  configuration: "配置与扩展",
  conflict: "冲突",
  uncovered: "未覆盖项",
  risk: "风险与未决事项",
  impact_confirmed: "已确认依赖",
  impact_possible: "可能影响",
  impact_unknown: "未知与覆盖限制",
  checklist: "检查清单",
  spec: "规格条目",
};

export const REJECT: Record<RejectReason, string> = {
  factually_wrong: "事实错误",
  citation_not_supporting: "引用不支持结论",
  duplicate: "重复",
  irrelevant: "无关",
  missing_material: "缺资料",
  other: "其他",
};

export const ANALYSIS_STATUS: Record<string, string> = {
  draft: "草稿",
  pending_review: "待核对",
  report_saved: "已保存报告",
  archived: "已归档",
};

export const REPORT_STATUS: Record<string, string> = {
  draft: "草稿",
  reviewed_open: "已核对（有未决项）",
  reviewed_clear: "已核对（无已知未决项）",
};

export const VALIDITY: Record<string, string> = {
  valid: "有效",
  needs_review: "待复核",
  source_deleted: "来源已删除",
};

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("zh-CN", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
