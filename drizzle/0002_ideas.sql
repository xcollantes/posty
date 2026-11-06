CREATE TABLE "idea_groups" (
	"idea_group_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "idea_tags" (
	"idea_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "idea_tags_idea_id_tag_id_pk" PRIMARY KEY("idea_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"idea_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_group_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"media_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"networks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idea_tags" ADD CONSTRAINT "idea_tags_idea_id_ideas_idea_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("idea_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_tags" ADD CONSTRAINT "idea_tags_tag_id_tags_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("tag_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_idea_group_id_idea_groups_idea_group_id_fk" FOREIGN KEY ("idea_group_id") REFERENCES "public"."idea_groups"("idea_group_id") ON DELETE set null ON UPDATE no action;