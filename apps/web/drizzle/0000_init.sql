CREATE TYPE "public"."agent_event_type" AS ENUM('agent.woke', 'agent.pong', 'agent.error', 'intake.parsed', 'brief.generated', 'change.detected', 'change.applied', 'plan.updated', 'submission.hold_notice_sent', 'submission.checks_run', 'submission.submitted', 'submission.failed', 'alert.sent');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('provisioning', 'ready', 'asleep', 'error', 'deleting');--> statement-breakpoint
CREATE TYPE "public"."assignment_source" AS ENUM('syllabus', 'ics', 'email', 'manual');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('todo', 'in_progress', 'done', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."assignment_type" AS ENUM('assignment', 'quiz', 'exam', 'project', 'lab', 'reading', 'presentation', 'other');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('in_app', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('draft', 'checks_failed', 'ready', 'scheduled', 'held', 'submitting', 'submitted', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid,
	"event_id" text NOT NULL,
	"request_id" text,
	"type" "agent_event_type" NOT NULL,
	"reason" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"maritime_agent_id" text,
	"status" "agent_status" DEFAULT 'provisioning' NOT NULL,
	"agent_token_hash" text NOT NULL,
	"last_error" text,
	"config_written_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assignment_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"source" text NOT NULL,
	"evidence" text,
	"confidence" real,
	"applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"weight_pct" real,
	"est_minutes" integer,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"type" "assignment_type" DEFAULT 'assignment' NOT NULL,
	"allowed_file_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "assignment_status" DEFAULT 'todo' NOT NULL,
	"source" "assignment_source" DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"confidence" real,
	"confirmed" boolean DEFAULT false NOT NULL,
	"notes" text,
	"assumption" text,
	"evidence" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"for_date" text NOT NULL,
	"items_json" jsonb NOT NULL,
	"summary_text" text NOT NULL,
	"trigger" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"instructor" text,
	"schedule_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_addr" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"body_hash" text NOT NULL,
	"classification" text,
	"status" text DEFAULT 'received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" "channel" NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"confirmation_id" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"portal_snapshot_ref" text,
	"file_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_sha256" text NOT NULL,
	"agent_file_path" text,
	"status" "submission_status" DEFAULT 'draft' NOT NULL,
	"submit_at" timestamp with time zone,
	"submit_at_from_default" boolean DEFAULT true NOT NULL,
	"hold_until" timestamp with time zone,
	"hold_notice_sent_at" timestamp with time zone,
	"consent_at" timestamp with time zone,
	"checks_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT 'America/Vancouver' NOT NULL,
	"brief_time_local" text DEFAULT '07:30' NOT NULL,
	"channel" "channel" DEFAULT 'in_app' NOT NULL,
	"telegram_chat_id" text,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_changes" ADD CONSTRAINT "assignment_changes_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_events_user_event_uq" ON "agent_events" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "agent_events_user_time_idx" ON "agent_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_user_uq" ON "agents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_token_hash_uq" ON "agents" USING btree ("agent_token_hash");--> statement-breakpoint
CREATE INDEX "assignments_user_due_idx" ON "assignments" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "briefs_user_date_idx" ON "briefs" USING btree ("user_id","for_date");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_user_code_uq" ON "courses" USING btree ("user_id",upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_user_body_uq" ON "inbox_messages" USING btree ("user_id","body_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_idem_uq" ON "submissions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "submissions_due_idx" ON "submissions" USING btree ("status","submit_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));