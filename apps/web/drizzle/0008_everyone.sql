ALTER TYPE "public"."assignment_type" ADD VALUE 'bill' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."assignment_type" ADD VALUE 'appointment' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."assignment_type" ADD VALUE 'task' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."assignment_type" ADD VALUE 'event' BEFORE 'other';--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "source" text DEFAULT 'email' NOT NULL;