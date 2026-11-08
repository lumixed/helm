ALTER TYPE "public"."agent_event_type" ADD VALUE 'routine.sent' BEFORE 'inbox.classified';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "routines_json" jsonb DEFAULT '{}'::jsonb NOT NULL;