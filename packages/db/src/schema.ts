// Postgres schema for PRD §7.3.
//
// Every product-owned table carries product_id and a UNIQUE (product_id, id).
// References between product-owned rows are composite foreign keys on
// (product_id, x_id), so the database itself refuses cross-product links (F02).
// The service layer still checks ownership; this is the second wall, not the first.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const productId = () => text("product_id").notNull();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const revision = () => integer("revision").notNull().default(0);

/** Composite FK to a product-scoped parent. Cascades with the product, never across products. */
function owned(name: string, cols: [AnyPgColumn, AnyPgColumn], parent: { productId: AnyPgColumn; id: AnyPgColumn }) {
  return foreignKey({ name, columns: cols, foreignColumns: [parent.productId, parent.id] }).onDelete("cascade");
}

export const products = pgTable("products", {
  id: id(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isExample: boolean("is_example").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

const productFk = (t: { productId: AnyPgColumn }, name: string) =>
  foreignKey({ name, columns: [t.productId], foreignColumns: [products.id] }).onDelete("cascade");

export const analyses = pgTable(
  "analyses",
  {
    id: id(),
    productId: productId(),
    title: text("title").notNull(),
    goal: text("goal").notNull().default(""),
    changeDescription: text("change_description").notNull().default(""),
    status: text("status", { enum: ["draft", "pending_review", "report_saved", "archived"] }).notNull().default("draft"),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [productFk(t, "analyses_product_fk"), unique("analyses_product_id_uq").on(t.productId, t.id)],
);

export const sources = pgTable(
  "sources",
  {
    id: id(),
    productId: productId(),
    kind: text("kind", { enum: ["file", "paste", "request_text"] }).notNull(),
    name: text("name").notNull(),
    /** User-entered metadata only. Never fetched (F03). */
    originalUrl: text("original_url"),
    createdAt: createdAt(),
  },
  (t) => [productFk(t, "sources_product_fk"), unique("sources_product_id_uq").on(t.productId, t.id)],
);

export const sourceVersions = pgTable(
  "source_versions",
  {
    id: id(),
    productId: productId(),
    sourceId: text("source_id").notNull(),
    version: integer("version").notNull(),
    /** Null after permanent deletion; the row stays as a tombstone so old reports can show a placeholder (§8.3). */
    text: text("text"),
    contentHash: text("content_hash").notNull(),
    charCount: integer("char_count").notNull(),
    /** Server-generated storage path for the original upload. Never user-supplied. */
    storageKey: text("storage_key"),
    validity: text("validity", { enum: ["valid", "needs_review", "source_deleted"] }).notNull().default("valid"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    owned("source_versions_source_fk", [t.productId, t.sourceId], sources),
    unique("source_versions_product_id_uq").on(t.productId, t.id),
    unique("source_versions_source_version_uq").on(t.sourceId, t.version),
    index("source_versions_hash_idx").on(t.productId, t.contentHash),
    check("source_versions_deleted_text", sql`(${t.validity} = 'source_deleted') = (${t.text} IS NULL)`),
  ],
);

export const evidences = pgTable(
  "evidences",
  {
    id: id(),
    productId: productId(),
    sourceVersionId: text("source_version_id").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    /** Null after the source is permanently deleted. */
    quote: text("quote"),
    quoteHash: text("quote_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    owned("evidences_source_version_fk", [t.productId, t.sourceVersionId], sourceVersions),
    unique("evidences_product_id_uq").on(t.productId, t.id),
    check("evidences_span", sql`${t.charStart} >= 0 AND ${t.charEnd} > ${t.charStart} AND ${t.lineEnd} >= ${t.lineStart}`),
  ],
);

export const requests = pgTable(
  "requests",
  {
    id: id(),
    productId: productId(),
    /** The verbatim request lives in a source version; this is its evidence span. */
    originalEvidenceId: text("original_evidence_id").notNull(),
    party: text("party").notNull(),
    sourceName: text("source_name").notNull().default(""),
    originalUrl: text("original_url"),
    /** Structured fields (title, user, goal, scenario, workaround, constraints, timing, type, questions). Missing = unknown. */
    fields: jsonb("fields").$type<Record<string, string | string[] | null>>().notNull().default({}),
    /** Idempotency key of the split-confirm batch that created it, so retries do not duplicate (F03). */
    batchKey: text("batch_key"),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    owned("requests_original_evidence_fk", [t.productId, t.originalEvidenceId], evidences),
    unique("requests_product_id_uq").on(t.productId, t.id),
    index("requests_batch_idx").on(t.productId, t.batchKey),
  ],
);

export const analysisRequests = pgTable(
  "analysis_requests",
  {
    productId: productId(),
    analysisId: text("analysis_id").notNull(),
    requestId: text("request_id").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.analysisId, t.requestId] }),
    owned("analysis_requests_analysis_fk", [t.productId, t.analysisId], analyses),
    owned("analysis_requests_request_fk", [t.productId, t.requestId], requests),
  ],
);

export const analysisSources = pgTable(
  "analysis_sources",
  {
    productId: productId(),
    analysisId: text("analysis_id").notNull(),
    sourceVersionId: text("source_version_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.analysisId, t.sourceVersionId] }),
    owned("analysis_sources_analysis_fk", [t.productId, t.analysisId], analyses),
    owned("analysis_sources_version_fk", [t.productId, t.sourceVersionId], sourceVersions),
  ],
);

const memoryValidity = () =>
  text("validity", { enum: ["valid", "needs_review", "obsolete"] }).notNull().default("valid");

export const systemNodes = pgTable(
  "system_nodes",
  {
    id: id(),
    productId: productId(),
    type: text("type", { enum: ["module", "interface", "data_object", "role", "business_party"] }).notNull(),
    name: text("name").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    /** Set when merged away; the row stays so old ids resolve to the survivor (F05). */
    mergedInto: text("merged_into"),
    validity: memoryValidity(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    revision: revision(),
    createdAt: createdAt(),
  },
  (t) => [
    productFk(t, "system_nodes_product_fk"),
    unique("system_nodes_product_id_uq").on(t.productId, t.id),
    foreignKey({ name: "system_nodes_merged_into_fk", columns: [t.productId, t.mergedInto], foreignColumns: [t.productId, t.id] }),
  ],
);

export const systemEdges = pgTable(
  "system_edges",
  {
    id: id(),
    productId: productId(),
    fromNodeId: text("from_node_id").notNull(),
    toNodeId: text("to_node_id").notNull(),
    type: text("type", { enum: ["depends_on", "calls", "reads", "writes", "contains", "owned_by"] }).notNull(),
    confirmation: text("confirmation", { enum: ["candidate", "confirmed", "rejected"] }).notNull().default("candidate"),
    /** Required once confirmed: document-backed or user-asserted without documents. */
    basis: text("basis", { enum: ["document", "user_asserted"] }),
    note: text("note").notNull().default(""),
    validity: memoryValidity(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    revision: revision(),
    createdAt: createdAt(),
  },
  (t) => [
    owned("system_edges_from_fk", [t.productId, t.fromNodeId], systemNodes),
    owned("system_edges_to_fk", [t.productId, t.toNodeId], systemNodes),
    unique("system_edges_product_id_uq").on(t.productId, t.id),
    index("system_edges_to_idx").on(t.productId, t.toNodeId),
    check("system_edges_no_self_loop", sql`${t.fromNodeId} <> ${t.toNodeId}`),
    check("system_edges_confirmed_basis", sql`${t.confirmation} <> 'confirmed' OR (${t.basis} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)`),
  ],
);

export const edgeEvidences = pgTable(
  "edge_evidences",
  {
    productId: productId(),
    edgeId: text("edge_id").notNull(),
    evidenceId: text("evidence_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.edgeId, t.evidenceId] }),
    owned("edge_evidences_edge_fk", [t.productId, t.edgeId], systemEdges),
    owned("edge_evidences_evidence_fk", [t.productId, t.evidenceId], evidences),
  ],
);

export const rules = pgTable(
  "rules",
  {
    id: id(),
    productId: productId(),
    content: text("content").notNull(),
    scope: text("scope").notNull().default(""),
    basis: text("basis", { enum: ["document", "user_asserted"] }).notNull(),
    evidenceId: text("evidence_id"),
    validity: memoryValidity(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    revision: revision(),
  },
  (t) => [
    productFk(t, "rules_product_fk"),
    owned("rules_evidence_fk", [t.productId, t.evidenceId], evidences),
    unique("rules_product_id_uq").on(t.productId, t.id),
  ],
);

export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    productId: productId(),
    analysisId: text("analysis_id"),
    content: text("content").notNull(),
    /** Decisions need a reason (§3.3 rule 4). AI suggestions never become decisions on their own. */
    reason: text("reason").notNull(),
    scope: text("scope").notNull().default(""),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    revision: revision(),
  },
  (t) => [
    productFk(t, "decisions_product_fk"),
    owned("decisions_analysis_fk", [t.productId, t.analysisId], analyses),
    unique("decisions_product_id_uq").on(t.productId, t.id),
    check("decisions_reason_present", sql`length(trim(${t.reason})) > 0`),
  ],
);

/** Doubles as the durable job queue: the worker claims `queued` rows with SKIP LOCKED (§7.1). */
export const analysisRuns = pgTable(
  "analysis_runs",
  {
    id: id(),
    productId: productId(),
    analysisId: text("analysis_id").notNull(),
    /** `manual` holds claims the user wrote without a model call (M1 manual flow). */
    taskType: text("task_type", { enum: ["manual", "split_requests", "extract_memory", "abstraction", "impact_inference"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed", "canceled", "interrupted"] }).notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    /** Frozen inputs: request ids, source version ids, memory versions, template version, model params. */
    inputSnapshot: jsonb("input_snapshot").notNull(),
    retryOfRunId: text("retry_of_run_id"),
    attempts: integer("attempts").notNull().default(0),
    errorKind: text("error_kind"),
    errorMessage: text("error_message"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    owned("analysis_runs_analysis_fk", [t.productId, t.analysisId], analyses),
    foreignKey({ name: "analysis_runs_retry_fk", columns: [t.productId, t.retryOfRunId], foreignColumns: [t.productId, t.id] }),
    unique("analysis_runs_product_id_uq").on(t.productId, t.id),
    uniqueIndex("analysis_runs_idempotency_uq").on(t.idempotencyKey),
    index("analysis_runs_queue_idx").on(t.status, t.createdAt),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: id(),
    productId: productId(),
    runId: text("run_id").notNull(),
    position: integer("position").notNull(),
    section: text("section").notNull(),
    kind: text("kind", { enum: ["source_fact", "confirmed_relation", "inference", "suggestion", "unknown"] }).notNull(),
    /** User-written claims are labelled "用户输入", never passed off as source text (§3.3 rule 4). */
    origin: text("origin", { enum: ["model", "user"] }).notNull().default("model"),
    text: text("text").notNull(),
    reasoning: text("reasoning"),
    missing: text("missing"),
    edgeId: text("edge_id"),
    requestIds: jsonb("request_ids").$type<string[]>().notNull().default([]),
    review: text("review", { enum: ["pending", "accepted", "corrected", "rejected"] }).notNull().default("pending"),
    /** Kept verbatim once the user corrects the claim (F08). */
    originalText: text("original_text"),
    originalKind: text("original_kind"),
    rejectReason: text("reject_reason", {
      enum: ["factually_wrong", "citation_not_supporting", "duplicate", "irrelevant", "missing_material", "other"],
    }),
    rejectNote: text("reject_note"),
    evidenceValidity: text("evidence_validity", { enum: ["valid", "needs_review", "source_deleted"] }).notNull().default("valid"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    revision: revision(),
  },
  (t) => [
    owned("claims_run_fk", [t.productId, t.runId], analysisRuns),
    owned("claims_edge_fk", [t.productId, t.edgeId], systemEdges),
    unique("claims_product_id_uq").on(t.productId, t.id),
    check("claims_reject_reason", sql`(${t.review} = 'rejected') = (${t.rejectReason} IS NOT NULL)`),
  ],
);

export const claimEvidences = pgTable(
  "claim_evidences",
  {
    productId: productId(),
    claimId: text("claim_id").notNull(),
    evidenceId: text("evidence_id").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.claimId, t.evidenceId] }),
    owned("claim_evidences_claim_fk", [t.productId, t.claimId], claims),
    owned("claim_evidences_evidence_fk", [t.productId, t.evidenceId], evidences),
  ],
);

export const reportVersions = pgTable(
  "report_versions",
  {
    id: id(),
    productId: productId(),
    analysisId: text("analysis_id").notNull(),
    version: integer("version").notNull(),
    status: text("status", { enum: ["draft", "reviewed_open", "reviewed_clear"] }).notNull(),
    /** Immutable once written, except for the privacy scrub on permanent source deletion (§8.3). */
    snapshot: jsonb("snapshot").notNull(),
    exportSchema: text("export_schema").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    owned("report_versions_analysis_fk", [t.productId, t.analysisId], analyses),
    unique("report_versions_product_id_uq").on(t.productId, t.id),
    unique("report_versions_analysis_version_uq").on(t.analysisId, t.version),
  ],
);

// Instance-level tables: not product-owned.

export const modelConfigs = pgTable("model_configs", {
  id: id(),
  adapter: text("adapter", { enum: ["anthropic_messages", "openai_compatible"] }).notNull(),
  endpoint: text("endpoint").notNull(),
  model: text("model").notNull(),
  /** AES-GCM ciphertext under the instance master key. Never returned to the browser. */
  apiKeyCiphertext: text("api_key_ciphertext"),
  apiKeyHint: text("api_key_hint"),
  allowLocalHttp: boolean("allow_local_http").notNull().default(false),
  contextLimit: integer("context_limit").notNull(),
  outputLimit: integer("output_limit").notNull().default(4000),
  inputPricePerMillion: text("input_price_per_million"),
  outputPricePerMillion: text("output_price_per_million"),
  isActive: boolean("is_active").notNull().default(false),
  revision: revision(),
  updatedAt: updatedAt(),
});

export const usageRecords = pgTable("usage_records", {
  id: id(),
  runId: text("run_id").references(() => analysisRuns.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  attempt: integer("attempt").notNull(),
  durationMs: integer("duration_ms").notNull(),
  /** Null when the provider did not report usage. Unknown is never stored as 0 (F09). */
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCost: text("estimated_cost"),
  createdAt: createdAt(),
});

export const localSessions = pgTable("local_sessions", {
  id: id(),
  /** SHA-256 of the session secret; the secret itself lives only in the HttpOnly cookie. */
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const instanceState = pgTable(
  "instance_state",
  {
    /** Single-row table; the check makes a second initialization impossible (F01). */
    singleton: boolean("singleton").primaryKey().default(true),
    initializedAt: timestamp("initialized_at", { withTimezone: true }).notNull().defaultNow(),
    accessCredentialHash: text("access_credential_hash").notNull(),
    credentialUpdatedAt: timestamp("credential_updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Id of the last setup code consumed, so a code works once even under concurrent requests. */
    lastSetupCodeId: text("last_setup_code_id"),
  },
  (t) => [check("instance_state_singleton", sql`${t.singleton}`)],
);

export const auditEvents = pgTable("audit_events", {
  id: id(),
  productId: text("product_id"),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  action: text("action").notNull(),
  /** Ids and field names only. No source text, prompts or keys. */
  meta: jsonb("meta").notNull().default({}),
  createdAt: createdAt(),
});
