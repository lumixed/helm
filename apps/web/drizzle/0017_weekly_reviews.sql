ALTER TYPE "public"."agent_event_type" ADD VALUE 'review.written';--> statement-breakpoint
CREATE TABLE "weekly_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_ending" text NOT NULL,
	"summary" text NOT NULL,
	"writer" text NOT NULL,
	"facts_json" jsonb NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_reviews_user_week_uq" ON "weekly_reviews" USING btree ("user_id","week_ending");