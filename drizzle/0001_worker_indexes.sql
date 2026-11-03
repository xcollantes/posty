CREATE INDEX "post_targets_status" ON "post_targets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "posts_status_scheduled_at" ON "posts" USING btree ("status","scheduled_at");