ALTER TYPE "public"."agent_event_type" ADD VALUE 'submission.scheduled' BEFORE 'submission.hold_notice_sent';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'submission.held' BEFORE 'submission.checks_run';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'submission.released' BEFORE 'submission.checks_run';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'submission.cancelled' BEFORE 'submission.checks_run';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'submission.retrying' BEFORE 'submission.checks_run';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'submission.adjusted' BEFORE 'submission.checks_run';--> statement-breakpoint
CREATE TABLE "portal_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"fail_next" integer DEFAULT 0 NOT NULL,
	"fail_mode" text DEFAULT '503' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"confirmation_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_sha256" text NOT NULL,
	"via" text DEFAULT 'agent' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "portal_env_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "driver" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "consent_sha256" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "driver" text DEFAULT 'http' NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "run_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "portal_state" ADD CONSTRAINT "portal_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_submissions_idem_uq" ON "portal_submissions" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_submissions_assignment_uq" ON "portal_submissions" USING btree ("user_id","assignment_id");