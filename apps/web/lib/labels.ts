import type { ClaimKind, ClaimSection, RejectReason, ReviewStatus } from "@pew/core";

export const KIND: Record<ClaimKind, string> = {
  source_fact: "Source fact",
  confirmed_relation: "Confirmed relation",
  inference: "Inference",
  suggestion: "Suggestion",
  unknown: "Unknown",
};

export const KIND_HELP: Record<ClaimKind, string> = {
  source_fact: "stated in a source; needs a citation",
  confirmed_relation: "a confirmed relation between nodes",
  inference: "derived from sources; needs reasoning and a citation",
  suggestion: "a proposal or check; needs reasoning",
  unknown: "missing material; say what is missing and who can supply it",
};

export const REVIEW: Record<ReviewStatus, string> = {
  pending: "Pending review",
  accepted: "Accepted",
  corrected: "Corrected",
  rejected: "Rejected",
};

export const SECTION: Record<ClaimSection, string> = {
  common_problem: "Common problem",
  capability: "Shared capability proposal",
  configuration: "Configuration and extensions",
  conflict: "Conflicts",
  uncovered: "Not covered",
  risk: "Risks and open questions",
  impact_confirmed: "Confirmed dependencies",
  impact_possible: "Possible impact",
  impact_unknown: "Unknowns and coverage limits",
  checklist: "Checklist",
  spec: "Spec items",
};

export const REJECT: Record<RejectReason, string> = {
  factually_wrong: "Factually wrong",
  citation_not_supporting: "Citation does not support it",
  duplicate: "Duplicate",
  irrelevant: "Irrelevant",
  missing_material: "Missing material",
  other: "Other",
};

export const ANALYSIS_STATUS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  report_saved: "Report saved",
  archived: "Archived",
};

export const REPORT_STATUS: Record<string, string> = {
  draft: "Draft",
  reviewed_open: "Reviewed (open items remain)",
  reviewed_clear: "Reviewed (no known open items)",
};

export const VALIDITY: Record<string, string> = {
  valid: "Current",
  needs_review: "Needs review",
  source_deleted: "Source deleted",
};

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const NODE_TYPE: Record<string, string> = {
  module: "Module",
  interface: "Interface",
  data_object: "Data object",
  role: "Role / permission",
  business_party: "Business party",
};

/** "1 request", "3 requests". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
