ALTER TYPE "public"."agent_event_type" ADD VALUE 'brief.failed' BEFORE 'change.detected';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'egress.blocked';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'egress.allowed';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'sandbox.created';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'sandbox.command';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'sandbox.ended';--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN "request_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "briefs_user_request_uq" ON "briefs" USING btree ("user_id","request_id");