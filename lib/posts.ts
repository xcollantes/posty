import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import type { PostContent, PostPart } from "@/lib/db/schema";
import { loadMedia } from "@/lib/media";
import { NETWORKS, validatePart, type NetworkId } from "@/lib/networks/catalog";
import { nextFreeSlot } from "@/lib/queue";

export type TargetInput = {
  socialAccountId: string;
  override: PostContent | null;
  options: Record<string, string>;
};

export type SavePostInput = {
  postId?: string;
  parts: PostPart[];
  targets: TargetInput[];
  tagIds: string[];
  mode: "draft" | "schedule" | "queue" | "now";
  scheduledAt?: string | null;
};

export type ActionResult = { ok: true; postId: string; scheduledAt: string | null } | { ok: false; error: string };

const cleanParts = (parts: PostPart[]): PostPart[] =>
  parts
    .map((p) => ({ text: String(p.text ?? ""), mediaIds: (p.mediaIds ?? []).map(String).slice(0, 35) }))
    .filter((p, i) => i === 0 || p.text.trim() || p.mediaIds.length);

export async function validateTargets(targets: TargetInput[], parts: PostPart[]): Promise<string[]> {
  const ids = targets.map((t) => t.socialAccountId);
  const accounts = ids.length
    ? await db.select().from(schema.socialAccounts).where(inArray(schema.socialAccounts.socialAccountId, ids))
    : [];
  const byId = new Map(accounts.map((a) => [a.socialAccountId, a]));
  const errors: string[] = [];
  for (const t of targets) {
    const acct = byId.get(t.socialAccountId);
    if (!acct) {
      errors.push("A selected account no longer exists");
      continue;
    }
    const network = acct.network as NetworkId;
    const content = t.override ? cleanParts(t.override.parts) : parts;
    const used = NETWORKS[network].threads ? content : content.slice(0, 1);
    for (const part of used) {
      const media = await loadMedia(part.mediaIds);
      errors.push(...validatePart(network, { text: part.text, media }, t.options ?? {}, acct.meta));
    }
  }
  return [...new Set(errors)];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Next queue slot no other post holds. `postId` is the post being moved, if any. */
export async function nextQueueSlot(timezone: string, postId?: string, conn: typeof db | Tx = db): Promise<Date | null> {
  const slots = await conn.select().from(schema.queueSlots);
  const taken = await conn
    .select({ at: schema.posts.scheduledAt })
    .from(schema.posts)
    .where(
      and(
        isNotNull(schema.posts.scheduledAt),
        ne(schema.posts.status, "draft"),
        postId ? ne(schema.posts.postId, postId) : undefined,
      ),
    );
  return nextFreeSlot(slots, taken.map((r) => r.at!), timezone);
}

async function resolveSchedule(input: SavePostInput, timezone: string, postId: string | undefined, tx: Tx): Promise<Date | null> {
  if (input.mode === "now") return new Date();
  if (input.mode === "draft") return input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (input.mode === "schedule") {
    const at = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (!at || Number.isNaN(at.getTime())) throw new Error("Pick a date and time");
    return at;
  }
  // Reason: otherwise posts queued at the same moment all see the same free slot.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('posty:queue'))`);
  const at = await nextQueueSlot(timezone, postId, tx);
  if (at) return at;
  const slots = await tx.select().from(schema.queueSlots);
  throw new Error(
    slots.length ? "No free queue slot in the next 12 weeks" : "Your queue has no time slots yet: add some on the Queue page",
  );
}

/**
 * Lock a post's targets, so claimDue (SKIP LOCKED) can't take them while the
 * post changes. Throws if the worker already has one.
 */
async function lockTargets(tx: Tx, postId: string) {
  const targets = await tx
    .select({ status: schema.postTargets.status, providerPostId: schema.postTargets.providerPostId })
    .from(schema.postTargets)
    .where(eq(schema.postTargets.postId, postId))
    .for("update");
  if (targets.some((t) => t.status === "publishing")) throw new Error("This post is publishing right now");
  return targets;
}

/**
 * Create or update a post on behalf of an already-authenticated user.
 * Kept out of the "use server" actions file: every export there is a
 * public endpoint, and this one trusts its `user` argument.
 */
export async function savePostAs(user: CurrentUser, input: SavePostInput): Promise<ActionResult> {
  try {
    const parts = cleanParts(input.parts ?? []);
    if (!parts.length) return { ok: false, error: "Write something first" };
    const targets = (input.targets ?? []).filter((t, i, all) =>
      all.findIndex((o) => o.socialAccountId === t.socialAccountId) === i,
    );
    // Reason: publishing skips ids it can't find, so a bad one would post without its file.
    const mediaIds = [...new Set([...parts, ...targets.flatMap((t) => t.override?.parts ?? [])].flatMap((p) => p.mediaIds))];
    const found = new Set((await loadMedia(mediaIds)).map((m) => m.mediaId));
    const missing = mediaIds.filter((id) => !found.has(id));
    if (missing.length) return { ok: false, error: `Unknown media: ${missing.join(", ")}` };
    if (input.mode !== "draft") {
      if (!targets.length) return { ok: false, error: "Choose at least one account" };
      const errors = await validateTargets(targets, parts);
      if (errors.length) return { ok: false, error: errors.join("\n") };
    }

    if (input.postId) {
      const [existing] = await db.select().from(schema.posts).where(eq(schema.posts.postId, input.postId));
      if (!existing) return { ok: false, error: "Post not found" };
      if (existing.status === "published" || existing.status === "partial") {
        return { ok: false, error: "This post already went out. Duplicate it to post again." };
      }
    }

    const status = input.mode === "draft" ? "draft" : "scheduled";
    const content: PostContent = { parts };

    return await db.transaction(async (tx) => {
      let id = input.postId;
      if (id) {
        // Reason: saving re-creates every target, which would publish live ones again.
        const current = await lockTargets(tx, id);
        if (current.some((t) => t.status === "published" || t.providerPostId)) {
          throw new Error("Part of this post already went out. Duplicate it to post again.");
        }
      }
      const scheduledAt = await resolveSchedule(input, user.timezone, id, tx);
      if (id) {
        await tx
          .update(schema.posts)
          .set({ content, status, scheduledAt, updatedAt: new Date() })
          .where(eq(schema.posts.postId, id));
        await tx.delete(schema.postTargets).where(eq(schema.postTargets.postId, id));
        await tx.delete(schema.postTags).where(eq(schema.postTags.postId, id));
      } else {
        const [row] = await tx
          .insert(schema.posts)
          .values({ content, status, scheduledAt, createdBy: user.userId })
          .returning({ postId: schema.posts.postId });
        id = row.postId;
      }
      if (targets.length) {
        await tx.insert(schema.postTargets).values(
          targets.map((t) => ({
            postId: id!,
            socialAccountId: t.socialAccountId,
            contentOverride: t.override ? { parts: cleanParts(t.override.parts) } : null,
            options: Object.fromEntries(
              Object.entries(t.options ?? {}).map(([k, v]) => [k, String(v)]),
            ),
          })),
        );
      }
      if (input.tagIds?.length) {
        await tx.insert(schema.postTags).values(input.tagIds.map((tagId) => ({ postId: id!, tagId })));
      }
      return { ok: true, postId: id!, scheduledAt: scheduledAt?.toISOString() ?? null };
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** A post in the shape savePostAs takes, for saving it again with changes. */
export async function loadPost(postId: string) {
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.postId, postId));
  if (!post) return null;
  const [targets, tags] = await Promise.all([
    db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, postId)),
    db.select().from(schema.postTags).where(eq(schema.postTags.postId, postId)),
  ]);
  return {
    status: post.status,
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
    parts: post.content.parts,
    targets: targets.map(
      (t): TargetInput => ({ socialAccountId: t.socialAccountId, override: t.contentOverride ?? null, options: t.options }),
    ),
    tagIds: tags.map((t) => t.tagId),
  };
}

/** Delete a post's record. What's already live on a network stays there. */
export async function deletePostChecked(postId: string): Promise<{ error?: string }> {
  try {
    const deleted = await db.transaction(async (tx) => {
      // Reason: a post deleted mid-publish goes live with no record of it here.
      await lockTargets(tx, postId);
      return tx.delete(schema.posts).where(eq(schema.posts.postId, postId)).returning({ postId: schema.posts.postId });
    });
    return deleted.length ? {} : { error: "Post not found" };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Re-queue failed targets now. Published targets are left alone. */
export async function retryFailedTargets(postId: string): Promise<{ error?: string }> {
  const [post] = await db.select({ status: schema.posts.status }).from(schema.posts).where(eq(schema.posts.postId, postId));
  // Reason: this sets the post to go out now, which on a draft would publish it.
  if (post?.status !== "failed" && post?.status !== "partial") return { error: "Only failed posts can be retried" };
  await db
    .update(schema.postTargets)
    .set({ status: "pending", attemptCount: 0, nextAttemptAt: null, error: null })
    .where(and(eq(schema.postTargets.postId, postId), eq(schema.postTargets.status, "failed")));
  await db
    .update(schema.posts)
    .set({ status: "scheduled", scheduledAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.posts.postId, postId));
  return {};
}

/** Tag ids for these names, creating any that don't exist yet. */
export async function tagIdsFor(names: string[]): Promise<string[]> {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!clean.length) return [];
  await db.insert(schema.tags).values(clean.map((name) => ({ name }))).onConflictDoNothing();
  const rows = await db.select({ tagId: schema.tags.tagId }).from(schema.tags).where(inArray(schema.tags.name, clean));
  return rows.map((r) => r.tagId);
}
