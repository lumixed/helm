ALTER TYPE "public"."agent_event_type" ADD VALUE 'desktop.takeover' BEFORE 'egress.blocked';--> statement-breakpoint
ALTER TYPE "public"."agent_event_type" ADD VALUE 'desktop.checked' BEFORE 'egress.blocked';--> statement-breakpoint
CREATE TABLE "desktop_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app" text NOT NULL,
	"computer_id" text NOT NULL,
	"status" text DEFAULT 'linking' NOT NULL,
	"linked_at" timestamp with time zone,
	"last_check_at" timestamp with time zone,
	"last_error" text,
	"seen_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desktop_apps" ADD CONSTRAINT "desktop_apps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "desktop_apps_user_app_uq" ON "desktop_apps" USING btree ("user_id","app");