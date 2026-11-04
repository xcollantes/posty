"use server";

import { and, between, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
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

async function validateTargets(targets: TargetInput[], parts: PostPart[]): Promise<string[]> {
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

async function resolveSchedule(input: SavePostInput, timezone: string, postId?: string): Promise<Date | null> {
  if (input.mode === "now") return new Date();
  if (input.mode === "draft") return input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (input.mode === "schedule") {
    const at = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (!at || Number.isNaN(at.getTime())) throw new Error("Pick a date and time");
    return at;
  }
  const slots = await db.select().from(schema.queueSlots);
  if (!slots.length) throw new Error("Your queue has no time slots yet: add some on the Queue page");
  const taken = await db
    .select({ at: schema.posts.scheduledAt })
    .from(schema.posts)
    .where(
      and(
        isNotNull(schema.posts.scheduledAt),
        ne(schema.posts.status, "draft"),
        postId ? ne(schema.posts.postId, postId) : undefined,
      ),
    );
  const at = nextFreeSlot(slots, taken.map((r) => r.at!), timezone);
  if (!at) throw new Error("No free queue slot in the next 12 weeks");
  return at;
}

export async function savePost(input: SavePostInput): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const parts = cleanParts(input.parts ?? []);
    if (!parts.length) return { ok: false, error: "Write something first" };
    const targets = (input.targets ?? []).filter((t, i, all) =>
      all.findIndex((o) => o.socialAccountId === t.socialAccountId) === i,
    );
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
      const inFlight = await db
        .select({ id: schema.postTargets.postTargetId })
        .from(schema.postTargets)
        .where(and(eq(schema.postTargets.postId, input.postId), eq(schema.postTargets.status, "publishing")));
      if (inFlight.length) return { ok: false, error: "This post is publishing right now" };
    }

    const scheduledAt = await resolveSchedule(input, user.timezone, input.postId);
    const status = input.mode === "draft" ? "draft" : "scheduled";
    const content: PostContent = { parts };

    const postId = await db.transaction(async (tx) => {
      let id = input.postId;
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
      return id!;
    });

    revalidatePath("/", "layout");
    return { ok: true, postId, scheduledAt: scheduledAt?.toISOString() ?? null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function deletePost(postId: string) {
  await requireUser();
  await db.delete(schema.posts).where(eq(schema.posts.postId, postId));
  revalidatePath("/", "layout");
}

/** Copy a post (any status) into a new draft. */
export async function duplicatePost(postId: string): Promise<string | null> {
  const user = await requireUser();
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.postId, postId));
  if (!post) return null;
  const targets = await db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, postId));
  const tags = await db.select().from(schema.postTags).where(eq(schema.postTags.postId, postId));
  const newId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.posts)
      .values({ content: post.content, status: "draft", createdBy: user.userId })
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
  await db
    .update(schema.postTargets)
    .set({ status: "pending", attemptCount: 0, nextAttemptAt: null, error: null })
    .where(and(eq(schema.postTargets.postId, postId), eq(schema.postTargets.status, "failed")));
  await db
    .update(schema.posts)
    .set({ status: "scheduled", scheduledAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.posts.postId, postId));
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
  color: string;
  networks: string[];
};

export async function calendarEvents(startIso: string, endIso: string): Promise<CalendarEvent[]> {
  await requireUser();
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
    .where(between(schema.posts.scheduledAt, new Date(startIso), new Date(endIso)))
    .groupBy(schema.posts.postId);
  const statusColor: Record<string, string> = {
    draft: "#94a3b8",
    scheduled: "#0ea5e9",
    published: "#16a34a",
    partial: "#f59e0b",
    failed: "#dc2626",
  };
  return rows.map((r) => ({
    id: r.postId,
    title: r.content.parts[0]?.text.slice(0, 80) || "(media only)",
    start: r.scheduledAt!.toISOString(),
    status: r.status,
    color: r.tagColor ?? statusColor[r.status] ?? "#0ea5e9",
    networks: r.networks,
  }));
}
