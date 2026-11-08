ALTER TYPE "public"."agent_event_type" ADD VALUE 'website.started';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'website.waiting';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'website.approved';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'website.finished';--> statement-breakpoint
CREATE TABLE "web_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instruction" text NOT NULL,
	"start_url" text NOT NULL,
	"allowed_hosts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text DEFAULT 'app' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"computer_id" text,
	"step_count" integer DEFAULT 0 NOT NULL,
	"steps_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_json" jsonb,
	"field_focused" boolean DEFAULT false NOT NULL,
	"screenshot_b64" text,
	"result" text,
	"locked_until" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_tasks" ADD CONSTRAINT "web_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "web_tasks_user_status_idx" ON "web_tasks" USING btree ("user_id","status");