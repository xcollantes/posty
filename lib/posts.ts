import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
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
