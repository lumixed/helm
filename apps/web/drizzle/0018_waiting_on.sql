ALTER TYPE "public"."agent_event_type" ADD VALUE 'followup.found';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'followup.drafted';--> statement-breakpoint
CREATE TABLE "waiting_on" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"to_name" text NOT NULL,
	"subject" text NOT NULL,
	"summary" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"drafted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waiting_on" ADD CONSTRAINT "waiting_on_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waiting_on_user_thread_uq" ON "waiting_on" USING btree ("user_id","thread_id");