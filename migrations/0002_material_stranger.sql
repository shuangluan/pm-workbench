ALTER TABLE "source_versions" DROP CONSTRAINT "source_versions_deleted_text";--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "change_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "source_versions" ADD COLUMN "media_type" text;--> statement-breakpoint
ALTER TABLE "source_versions" ADD COLUMN "byte_size" integer;--> statement-breakpoint
ALTER TABLE "source_versions" ADD COLUMN "derived_from_version_id" text;--> statement-breakpoint
ALTER TABLE "source_versions" ADD COLUMN "transcribed_by" text;--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_derived_from_fk" FOREIGN KEY ("product_id","derived_from_version_id") REFERENCES "public"."source_versions"("product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_content" CHECK (CASE WHEN "source_versions"."validity" = 'source_deleted' THEN "source_versions"."text" IS NULL AND "source_versions"."storage_key" IS NULL ELSE "source_versions"."text" IS NOT NULL OR "source_versions"."storage_key" IS NOT NULL END);