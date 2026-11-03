ALTER TABLE "claims" ADD COLUMN "origin" text DEFAULT 'model' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_state" ADD COLUMN "credential_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_state" ADD COLUMN "last_setup_code_id" text;