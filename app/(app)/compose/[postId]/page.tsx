import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Composer } from "@/components/composer/Composer";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { composerData, mediaForIds } from "../data";

export const metadata: Metadata = { title: "Edit post" };

export default async function EditPostPage({ params }: PageProps<"/compose/[postId]">) {
  const user = await requireUser();
  const { postId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(postId)) notFound();
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.postId, postId));
  if (!post) notFound();
  const [targets, tags, data] = await Promise.all([
    db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, postId)),
    db.select().from(schema.postTags).where(eq(schema.postTags.postId, postId)),
    composerData(user.timezone, postId),
  ]);

  const ids = [
    ...post.content.parts.flatMap((p) => p.mediaIds),
    ...targets.flatMap((t) => t.contentOverride?.parts.flatMap((p) => p.mediaIds) ?? []),
  ];
  const extra = await mediaForIds(ids, new Set(data.library.map((m) => m.mediaId)));
  const readOnly = post.status === "published" || post.status === "partial";

  return (
    <div>
      <h1 className="mb-6">{readOnly ? "Post" : post.status === "draft" ? "Edit draft" : "Edit post"}</h1>
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
    </div>
  );
}
