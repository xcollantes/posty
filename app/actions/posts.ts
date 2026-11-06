"use server";

import { and, between, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { deletePostChecked, retryFailedTargets, savePostAs, type ActionResult, type SavePostInput } from "@/lib/posts";
import { activeWorkspaceId } from "@/lib/workspaces";

export type { ActionResult, SavePostInput, TargetInput } from "@/lib/posts";

export async function savePost(input: SavePostInput): Promise<ActionResult> {
  const result = await savePostAs(await requireUser(), input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function deletePost(postId: string) {
  await requireUser();
  await deletePostChecked(postId);
  revalidatePath("/", "layout");
}

/** Copy a post (any status) into a new draft. */
export async function duplicatePost(postId: string): Promise<string | null> {
  const user = await requireUser();
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.postId, postId));
  if (!post) return null;
  // Reason: an account moved since is another company's now, so the copy doesn't target it.
  const targets = await db
    .select()
    .from(schema.postTargets)
    .where(
      and(
        eq(schema.postTargets.postId, postId),
        inArray(
          schema.postTargets.socialAccountId,
          db
            .select({ id: schema.socialAccounts.socialAccountId })
            .from(schema.socialAccounts)
            .where(eq(schema.socialAccounts.workspaceId, post.workspaceId)),
        ),
      ),
    );
  const tags = await db.select().from(schema.postTags).where(eq(schema.postTags.postId, postId));
  const newId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.posts)
      .values({ workspaceId: post.workspaceId, content: post.content, status: "draft", createdBy: user.userId })
      .returning({ postId: schema.posts.postId });
    if (targets.length) {
      await tx.insert(schema.postTargets).values(
        targets.map((t) => ({
          postId: row.postId,
          socialAccountId: t.socialAccountId,
          contentOverride: t.contentOverride,
          options: t.options,
        })),
      );
    }
    if (tags.length) await tx.insert(schema.postTags).values(tags.map((t) => ({ postId: row.postId, tagId: t.tagId })));
    return row.postId;
  });
  revalidatePath("/", "layout");
  return newId;
}

/** Re-queue failed targets now. Published targets are left alone. */
export async function retryPost(postId: string) {
  await requireUser();
  await retryFailedTargets(postId);
  revalidatePath("/", "layout");
}

export async function reschedulePost(postId: string, iso: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { ok: false, error: "Invalid date" };
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.postId, postId));
  if (!post || !["draft", "scheduled"].includes(post.status)) {
    return { ok: false, error: "Only drafts and scheduled posts can be moved" };
  }
  const busy = await db
    .select({ id: schema.postTargets.postTargetId })
    .from(schema.postTargets)
    .where(and(eq(schema.postTargets.postId, postId), eq(schema.postTargets.status, "publishing")));
  if (busy.length) return { ok: false, error: "This post is publishing right now" };
  await db.update(schema.posts).set({ scheduledAt: at, updatedAt: new Date() }).where(eq(schema.posts.postId, postId));
  revalidatePath("/", "layout");
  return { ok: true };
}

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  status: string;
  /** Color of the post's first tag, if any. */
  tagColor: string | null;
  networks: string[];
};

export async function calendarEvents(startIso: string, endIso: string): Promise<CalendarEvent[]> {
  await requireUser();
  const workspaceId = await activeWorkspaceId();
  const rows = await db
    .select({
      postId: schema.posts.postId,
      status: schema.posts.status,
      scheduledAt: schema.posts.scheduledAt,
      content: schema.posts.content,
      networks: sql<string[]>`coalesce(array_agg(distinct ${schema.socialAccounts.network}) filter (where ${schema.socialAccounts.network} is not null), '{}')`,
      tagColor: sql<string | null>`min(${schema.tags.color})`,
    })
    .from(schema.posts)
    .leftJoin(schema.postTargets, eq(schema.postTargets.postId, schema.posts.postId))
    .leftJoin(schema.socialAccounts, eq(schema.socialAccounts.socialAccountId, schema.postTargets.socialAccountId))
    .leftJoin(schema.postTags, eq(schema.postTags.postId, schema.posts.postId))
    .leftJoin(schema.tags, eq(schema.tags.tagId, schema.postTags.tagId))
    .where(and(eq(schema.posts.workspaceId, workspaceId), between(schema.posts.scheduledAt, new Date(startIso), new Date(endIso))))
    .groupBy(schema.posts.postId);
  return rows.map((r) => ({
    id: r.postId,
    title: r.content.parts[0]?.text.slice(0, 80) || "(media only)",
    start: r.scheduledAt!.toISOString(),
    status: r.status,
    tagColor: r.tagColor,
    networks: r.networks,
  }));
}
