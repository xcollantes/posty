CREATE TABLE "workspaces" (
	"workspace_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "idea_groups" DROP CONSTRAINT "idea_groups_name_unique";--> statement-breakpoint
ALTER TABLE "tags" DROP CONSTRAINT "tags_name_unique";--> statement-breakpoint
ALTER TABLE "idea_groups" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "queue_slots" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "snippets" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
-- Hand-edited: NOT NULL columns can't be added to populated tables, so existing
-- rows are moved into a first workspace before the constraint goes on.
INSERT INTO "workspaces" ("name") VALUES ('My workspace');--> statement-breakpoint
UPDATE "idea_groups" SET "workspace_id" = (SELECT "workspace_id" FROM "workspaces" LIMIT 1);--> statement-breakpoint
UPDATE "ideas" SET "workspace_id" = (SELECT "workspace_id" FROM "workspaces" LIMIT 1);--> statement-breakpoint
UPDATE "media" SET "workspace_id" = (SELECT "workspace_id" FROM "workspaces" LIMIT 1);--> statement-breakpoint
UPDATE "posts" SET "workspace_id" = (SELECT "workspace_id" FROM "workspaces" LIMIT 1);--> statement-breakpoint
UPDATE "queue_slots" SET "workspace_id" = (SELECT "workspace_id" FROM "workspaces" LIMIT 1);--> statement-breakpoint
UPDATE "snippets" SET "workspace_id" = (SELECT "workspace_id" FROM "workspaces" LIMIT 1);--> statement-breakpoint
UPDATE "social_accounts" SET "workspace_id" = (SELECT "workspace_id" FROM "workspaces" LIMIT 1);--> statement-breakpoint
UPDATE "tags" SET "workspace_id" = (SELECT "workspace_id" FROM "workspaces" LIMIT 1);--> statement-breakpoint
ALTER TABLE "idea_groups" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_slots" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snippets" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "social_accounts" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "idea_groups" ADD CONSTRAINT "idea_groups_workspace_id_workspaces_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_workspace_id_workspaces_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_workspace_id_workspaces_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_workspace_id_workspaces_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_slots" ADD CONSTRAINT "queue_slots_workspace_id_workspaces_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_workspace_id_workspaces_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_workspace_id_workspaces_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_workspaces_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idea_groups_workspace_name" ON "idea_groups" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_workspace_name" ON "tags" USING btree ("workspace_id","name");