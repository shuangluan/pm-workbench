ALTER TABLE "model_configs" ALTER COLUMN "output_limit" SET DEFAULT 16000;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "output" jsonb;--> statement-breakpoint
ALTER TABLE "model_configs" ADD COLUMN "timeout_seconds" integer DEFAULT 120 NOT NULL;