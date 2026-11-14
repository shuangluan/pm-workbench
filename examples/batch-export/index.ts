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
export const EXAMPLE_LABEL = "Example · synthetic data";

const SOURCE_TEXT = {
  permission: `# Permission rules

## Customer visibility

Regular members can only access their own customers.
Team leads can access the team's customers.
`,
  export: `# Export rules

Only synchronous CSV export exists today.
These notes say nothing about limits for large exports.
`,
  data: `# Customer data

## Restricted fields

Phone number is a restricted field.
`,
};

function version(id: string, raw: string): SourceVersionText {
  const ingested = ingestText(raw);
  if (!ingested.ok) throw new Error(`example source ${id} failed ingestion: ${ingested.code}`);
  return { id, productId: PRODUCT_ID, text: ingested.text, validity: "valid" };
}

export const sources = [
  { name: "Permission rules", version: 1, sv: version("sv_permission_v1", SOURCE_TEXT.permission) },
  { name: "Export rules", version: 1, sv: version("sv_export_v1", SOURCE_TEXT.export) },
  { name: "Customer data", version: 1, sv: version("sv_data_v1", SOURCE_TEXT.data) },
];

function cite(id: string, sv: SourceVersionText, quote: string): Evidence {
  const [span, ...more] = findQuote(sv.text, quote);
  if (!span || more.length) throw new Error(`example quote must occur exactly once: ${quote}`);
  return makeEvidence(id, sv, span);
}

const [perm, exp, data] = sources.map((s) => s.sv) as [SourceVersionText, SourceVersionText, SourceVersionText];

export const evidence: Evidence[] = [
  cite("ev_member_own", perm, "Regular members can only access their own customers."),
  cite("ev_lead_team", perm, "Team leads can access the team's customers."),
  cite("ev_sync_csv", exp, "Only synchronous CSV export exists today."),
  cite("ev_no_volume", exp, "These notes say nothing about limits for large exports."),
  cite("ev_phone_restricted", data, "Phone number is a restricted field."),
];

export const registry = new EvidenceRegistry(evidence.map((e) => ({ evidence: e, validity: "valid" })));
export const handleOf = (evidenceId: string) => registry.entries().find((e) => e.evidenceId === evidenceId)!.handle;

export const requests = [
  { handle: "R1", party: "Operations", title: "Export filtered results", originalText: "Export the current filtered results for our weekly follow-up. Only the customers I can already see." },
  { handle: "R2", party: "Sales", title: "Export team customers", originalText: "Export all of the team's customers for quarterly follow-up." },
  { handle: "R3", party: "Support", title: "Export ticket customers", originalText: "Export the customers linked to the current tickets, but never include phone numbers." },
];

export const nodes: SystemNode[] = [
  { id: "n_export", productId: PRODUCT_ID, type: "module", name: "Export module" },
  { id: "n_permission", productId: PRODUCT_ID, type: "module", name: "Permission service" },
  { id: "n_customer", productId: PRODUCT_ID, type: "data_object", name: "Customer data" },
  { id: "n_report", productId: PRODUCT_ID, type: "module", name: "Reporting module" },
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
    text: "All three parties need to export a set of customers, each with their own scope, for offline follow-up.",
    evidence: [{ handle: h("ev_sync_csv") }],
    reasoning: "R1, R2 and R3 all ask for a customer list export; they differ in scope and fields.",
    requestHandles: ["R1", "R2", "R3"],
  },
  {
    section: "capability",
    kind: "suggestion",
    text: "Offer one export entry point: scope = current filter, ticket-linked or team, with fields decided by the visible field set. This is a design proposal, not an existing capability.",
    evidence: [{ handle: h("ev_sync_csv") }],
    reasoning: "Only synchronous CSV export exists, and the three parties differ mainly in scope and fields.",
    requestHandles: ["R1", "R2", "R3"],
  },
  {
    section: "conflict",
    kind: "source_fact",
    text: "Sales wants to export the whole team's customers, but regular members can only access their own customers and only team leads can access the team's. The requester's role needs confirming; it cannot be assumed that all sales staff get team access.",
    evidence: [{ handle: h("ev_member_own") }, { handle: h("ev_lead_team") }],
    requestHandles: ["R2"],
  },
  {
    section: "conflict",
    kind: "source_fact",
    text: "Support exports must never include phone numbers, which are a restricted field. This limit has to stay in the shared design and cannot become a setting that can be turned off.",
    evidence: [{ handle: h("ev_phone_restricted") }],
    requestHandles: ["R3"],
  },
  {
    section: "configuration",
    kind: "suggestion",
    text: "Configure export scope per party: Operations = current filter (own customers), Sales = team (team leads only), Support = ticket-linked. Excluding phone numbers is a fixed rule, not a setting.",
    evidence: [{ handle: h("ev_member_own") }, { handle: h("ev_lead_team") }, { handle: h("ev_phone_restricted") }],
    reasoning: "The parties differ mainly in scope; phone numbers are restricted, so configuration must not decide that.",
    requestHandles: ["R1", "R2", "R3"],
  },
  {
    section: "checklist",
    kind: "suggestion",
    text: "Regression checks: a regular member's export contains no one else's customers; a team lead's export matches the customer list; no role's export ever contains phone numbers.",
    evidence: [{ handle: h("ev_member_own") }, { handle: h("ev_phone_restricted") }],
    reasoning: "These cover the two existing rules on permissions and restricted fields, which a unified export is most likely to break.",
  },
  {
    section: "risk",
    kind: "unknown",
    text: "It is unclear how large exports can get and whether they need to run asynchronously.",
    evidence: [{ handle: h("ev_no_volume") }],
    missing: "Ask the export module owner for the current row and time limits of synchronous export.",
  },
];

export const coverage: CoverageRow[] = [
  { requestHandle: "R1", party: "Operations", goal: "Weekly follow-up on filtered results", shared: "Export customers by scope", specific: "Only customers the user can see", handling: "shared_capability", evidence: [h("ev_member_own")] },
  { requestHandle: "R2", party: "Sales", goal: "Quarterly follow-up on team customers", shared: "Export customers by scope", specific: "Team scope, depending on whether the requester is a team lead", handling: "configuration", evidence: [h("ev_lead_team")] },
  { requestHandle: "R3", party: "Support", goal: "Handle ticket-linked customers", shared: "Export customers by scope", specific: "Never include phone numbers", handling: "shared_capability", evidence: [h("ev_phone_restricted")] },
];

export function toRecords(drafts: ClaimDraft[], review: ClaimRecord["review"] = "pending"): ClaimRecord[] {
  return drafts.map((d, i) => ({ ...d, id: `cl_${i + 1}`, review, revision: 0, evidenceValidity: "valid" }));
}

export function exampleSnapshot(changedNodeIds: string[] = ["n_permission"]): ReportSnapshot {
  return {
    title: `Unified bulk export (${EXAMPLE_LABEL})`,
    goal: "Decide whether three export requests can become one shared export capability, and check the impact of a permission service change.",
    changeDescription: "Change how the permission service decides which customers are visible.",
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
    openQuestions: ["Is the sales requester a team lead?"],
    templateVersion: "report-v0.1",
  };
}
