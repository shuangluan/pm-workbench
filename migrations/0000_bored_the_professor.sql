CREATE TABLE "analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"title" text NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"change_description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analyses_product_id_uq" UNIQUE("product_id","id")
);
--> statement-breakpoint
CREATE TABLE "analysis_requests" (
	"product_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"request_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "analysis_requests_analysis_id_request_id_pk" PRIMARY KEY("analysis_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"task_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"retry_of_run_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_kind" text,
	"error_message" text,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_runs_product_id_uq" UNIQUE("product_id","id")
);
--> statement-breakpoint
CREATE TABLE "analysis_sources" (
	"product_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"source_version_id" text NOT NULL,
	CONSTRAINT "analysis_sources_analysis_id_source_version_id_pk" PRIMARY KEY("analysis_id","source_version_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"action" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidences" (
	"product_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "claim_evidences_claim_id_evidence_id_pk" PRIMARY KEY("claim_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"run_id" text NOT NULL,
	"position" integer NOT NULL,
	"section" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"reasoning" text,
	"missing" text,
	"edge_id" text,
	"request_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review" text DEFAULT 'pending' NOT NULL,
	"original_text" text,
	"original_kind" text,
	"reject_reason" text,
	"reject_note" text,
	"evidence_validity" text DEFAULT 'valid' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "claims_product_id_uq" UNIQUE("product_id","id"),
	CONSTRAINT "claims_reject_reason" CHECK (("claims"."review" = 'rejected') = ("claims"."reject_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"analysis_id" text,
	"content" text NOT NULL,
	"reason" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "decisions_product_id_uq" UNIQUE("product_id","id"),
	CONSTRAINT "decisions_reason_present" CHECK (length(trim("decisions"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "edge_evidences" (
	"product_id" text NOT NULL,
	"edge_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	CONSTRAINT "edge_evidences_edge_id_evidence_id_pk" PRIMARY KEY("edge_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "evidences" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"source_version_id" text NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"line_start" integer NOT NULL,
	"line_end" integer NOT NULL,
	"quote" text,
	"quote_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidences_product_id_uq" UNIQUE("product_id","id"),
	CONSTRAINT "evidences_span" CHECK ("evidences"."char_start" >= 0 AND "evidences"."char_end" > "evidences"."char_start" AND "evidences"."line_end" >= "evidences"."line_start")
);
--> statement-breakpoint
CREATE TABLE "instance_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"initialized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"access_credential_hash" text NOT NULL,
	CONSTRAINT "instance_state_singleton" CHECK ("instance_state"."singleton")
);
--> statement-breakpoint
CREATE TABLE "local_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "model_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"adapter" text NOT NULL,
	"endpoint" text NOT NULL,
	"model" text NOT NULL,
	"api_key_ciphertext" text,
	"api_key_hint" text,
	"allow_local_http" boolean DEFAULT false NOT NULL,
	"context_limit" integer NOT NULL,
	"output_limit" integer DEFAULT 4000 NOT NULL,
	"input_price_per_million" text,
	"output_price_per_million" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_example" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"export_schema" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_versions_product_id_uq" UNIQUE("product_id","id"),
	CONSTRAINT "report_versions_analysis_version_uq" UNIQUE("analysis_id","version")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"original_evidence_id" text NOT NULL,
	"party" text NOT NULL,
	"source_name" text DEFAULT '' NOT NULL,
	"original_url" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"batch_key" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_product_id_uq" UNIQUE("product_id","id")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"content" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"basis" text NOT NULL,
	"evidence_id" text,
	"validity" text DEFAULT 'valid' NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"last_reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rules_product_id_uq" UNIQUE("product_id","id")
);
--> statement-breakpoint
CREATE TABLE "source_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"source_id" text NOT NULL,
	"version" integer NOT NULL,
	"text" text,
	"content_hash" text NOT NULL,
	"char_count" integer NOT NULL,
	"storage_key" text,
	"validity" text DEFAULT 'valid' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_versions_product_id_uq" UNIQUE("product_id","id"),
	CONSTRAINT "source_versions_source_version_uq" UNIQUE("source_id","version"),
	CONSTRAINT "source_versions_deleted_text" CHECK (("source_versions"."validity" = 'source_deleted') = ("source_versions"."text" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"original_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_product_id_uq" UNIQUE("product_id","id")
);
--> statement-breakpoint
CREATE TABLE "system_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"from_node_id" text NOT NULL,
	"to_node_id" text NOT NULL,
	"type" text NOT NULL,
	"confirmation" text DEFAULT 'candidate' NOT NULL,
	"basis" text,
	"note" text DEFAULT '' NOT NULL,
	"validity" text DEFAULT 'valid' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_edges_product_id_uq" UNIQUE("product_id","id"),
	CONSTRAINT "system_edges_no_self_loop" CHECK ("system_edges"."from_node_id" <> "system_edges"."to_node_id"),
	CONSTRAINT "system_edges_confirmed_basis" CHECK ("system_edges"."confirmation" <> 'confirmed' OR ("system_edges"."basis" IS NOT NULL AND "system_edges"."confirmed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "system_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"merged_into" text,
	"validity" text DEFAULT 'valid' NOT NULL,
	"last_reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_nodes_product_id_uq" UNIQUE("product_id","id")
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"attempt" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_requests" ADD CONSTRAINT "analysis_requests_analysis_fk" FOREIGN KEY ("product_id","analysis_id") REFERENCES "public"."analyses"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_requests" ADD CONSTRAINT "analysis_requests_request_fk" FOREIGN KEY ("product_id","request_id") REFERENCES "public"."requests"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_analysis_fk" FOREIGN KEY ("product_id","analysis_id") REFERENCES "public"."analyses"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_retry_fk" FOREIGN KEY ("product_id","retry_of_run_id") REFERENCES "public"."analysis_runs"("product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sources" ADD CONSTRAINT "analysis_sources_analysis_fk" FOREIGN KEY ("product_id","analysis_id") REFERENCES "public"."analyses"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sources" ADD CONSTRAINT "analysis_sources_version_fk" FOREIGN KEY ("product_id","source_version_id") REFERENCES "public"."source_versions"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidences" ADD CONSTRAINT "claim_evidences_claim_fk" FOREIGN KEY ("product_id","claim_id") REFERENCES "public"."claims"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidences" ADD CONSTRAINT "claim_evidences_evidence_fk" FOREIGN KEY ("product_id","evidence_id") REFERENCES "public"."evidences"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_run_fk" FOREIGN KEY ("product_id","run_id") REFERENCES "public"."analysis_runs"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_edge_fk" FOREIGN KEY ("product_id","edge_id") REFERENCES "public"."system_edges"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_analysis_fk" FOREIGN KEY ("product_id","analysis_id") REFERENCES "public"."analyses"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_evidences" ADD CONSTRAINT "edge_evidences_edge_fk" FOREIGN KEY ("product_id","edge_id") REFERENCES "public"."system_edges"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_evidences" ADD CONSTRAINT "edge_evidences_evidence_fk" FOREIGN KEY ("product_id","evidence_id") REFERENCES "public"."evidences"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_source_version_fk" FOREIGN KEY ("product_id","source_version_id") REFERENCES "public"."source_versions"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_analysis_fk" FOREIGN KEY ("product_id","analysis_id") REFERENCES "public"."analyses"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_original_evidence_fk" FOREIGN KEY ("product_id","original_evidence_id") REFERENCES "public"."evidences"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_evidence_fk" FOREIGN KEY ("product_id","evidence_id") REFERENCES "public"."evidences"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_source_fk" FOREIGN KEY ("product_id","source_id") REFERENCES "public"."sources"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_edges" ADD CONSTRAINT "system_edges_from_fk" FOREIGN KEY ("product_id","from_node_id") REFERENCES "public"."system_nodes"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_edges" ADD CONSTRAINT "system_edges_to_fk" FOREIGN KEY ("product_id","to_node_id") REFERENCES "public"."system_nodes"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_nodes" ADD CONSTRAINT "system_nodes_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_nodes" ADD CONSTRAINT "system_nodes_merged_into_fk" FOREIGN KEY ("product_id","merged_into") REFERENCES "public"."system_nodes"("product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_runs_idempotency_uq" ON "analysis_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "analysis_runs_queue_idx" ON "analysis_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "requests_batch_idx" ON "requests" USING btree ("product_id","batch_key");--> statement-breakpoint
CREATE INDEX "source_versions_hash_idx" ON "source_versions" USING btree ("product_id","content_hash");--> statement-breakpoint
CREATE INDEX "system_edges_to_idx" ON "system_edges" USING btree ("product_id","to_node_id");