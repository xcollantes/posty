import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Composer } from "@/components/composer/Composer";
import { Page } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspaces";
import { composerData, mediaForIds } from "../data";

export const metadata: Metadata = { title: "Edit post" };

export default async function EditPostPage({ params }: PageProps<"/compose/[postId]">) {
  const { user, workspaceId } = await requireWorkspace();
  const { postId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(postId)) notFound();
  // Reason: never edit a post from a different workspace than the header shows.
  const [post] = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.postId, postId), eq(schema.posts.workspaceId, workspaceId)));
  if (!post) notFound();
  const [targets, tags, data] = await Promise.all([
    db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, postId)),
    db.select().from(schema.postTags).where(eq(schema.postTags.postId, postId)),
    composerData(workspaceId, user.timezone, postId),
  ]);

  const ids = [
    ...post.content.parts.flatMap((p) => p.mediaIds),
    ...targets.flatMap((t) => t.contentOverride?.parts.flatMap((p) => p.mediaIds) ?? []),
  ];
  const extra = await mediaForIds(ids, new Set(data.library.map((m) => m.mediaId)));
  const readOnly = post.status === "published" || post.status === "partial";

  return (
    <Page
      title={readOnly ? "Post" : post.status === "draft" ? "Edit draft" : "Edit post"}
    >
      <Composer
        {...data}
        library={[...extra, ...data.library]}
        initial={{
          postId,
          status: post.status,
          parts: post.content.parts,
          targets: targets.map((t) => ({
            socialAccountId: t.socialAccountId,
            override: t.contentOverride,
            options: t.options,
          })),
          tagIds: tags.map((t) => t.tagId),
          scheduledAt: post.scheduledAt?.toISOString() ?? null,
        }}
      />
    </Page>
  );
}
