ALTER TABLE "users" ADD COLUMN "calendar_host" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_synced_at" timestamp with time zone;