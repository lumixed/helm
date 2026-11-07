DROP INDEX "courses_user_code_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "courses_user_code_key" ON "courses" USING btree ("user_id","code");