ALTER TYPE "public"."agent_event_type" ADD VALUE 'reminder.set';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'reminder.fired';--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"rule_json" jsonb NOT NULL,
	"created_via" text DEFAULT 'you' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_occurrence_at" timestamp with time zone,
	"last_fired_by" text,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "reminders" USING btree ("user_id");