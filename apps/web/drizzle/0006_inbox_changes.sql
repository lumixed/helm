ALTER TYPE "public"."agent_event_type" ADD VALUE 'inbox.classified' BEFORE 'change.detected';--> statement-breakpoint
ALTER TYPE "public"."assignment_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "assignment_changes" ALTER COLUMN "assignment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_changes" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "assignment_changes" ADD COLUMN "inbox_message_id" uuid;--> statement-breakpoint
ALTER TABLE "assignment_changes" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "assignment_changes" ADD COLUMN "status" text DEFAULT 'applied' NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_changes" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "assignment_changes" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "result_json" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "decision" text;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "injection_suspected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignment_changes" ADD CONSTRAINT "assignment_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_changes" ADD CONSTRAINT "assignment_changes_inbox_message_id_inbox_messages_id_fk" FOREIGN KEY ("inbox_message_id") REFERENCES "public"."inbox_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_changes_user_status_idx" ON "assignment_changes" USING btree ("user_id","status");