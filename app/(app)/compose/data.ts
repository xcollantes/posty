import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { safeMeta, type NetworkId } from "@/lib/networks/catalog";
import { nextFreeSlot } from "@/lib/queue";
import { rowToMedia } from "@/components/composer/media";
import type { ComposerAccount, ComposerMedia } from "@/components/composer/types";

/** Everything the composer needs. `postId` is the post being edited, if any. */
export async function composerData(workspaceId: string, timezone: string, postId?: string) {
  const [accounts, mediaRows, snippets, tags, slots, taken] = await Promise.all([
    db
      .select()
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.workspaceId, workspaceId), eq(schema.socialAccounts.isActive, true)))
      .orderBy(asc(schema.socialAccounts.network), asc(schema.socialAccounts.name)),
    db.select().from(schema.media).where(eq(schema.media.workspaceId, workspaceId)).orderBy(desc(schema.media.createdAt)).limit(300),
    db.select().from(schema.snippets).where(eq(schema.snippets.workspaceId, workspaceId)).orderBy(asc(schema.snippets.name)),
    db.select().from(schema.tags).where(eq(schema.tags.workspaceId, workspaceId)).orderBy(asc(schema.tags.name)),
    db.select().from(schema.queueSlots).where(eq(schema.queueSlots.workspaceId, workspaceId)),
    db
      .select({ at: schema.posts.scheduledAt })
      .from(schema.posts)
      .where(
        and(
          eq(schema.posts.workspaceId, workspaceId),
          isNotNull(schema.posts.scheduledAt),
          ne(schema.posts.status, "draft"),
          postId ? ne(schema.posts.postId, postId) : undefined,
        ),
      ),
  ]);
  // Same rule savePost() uses for "Add to queue", shown ahead of time.
  const nextSlot = nextFreeSlot(slots, taken.map((t) => t.at!), timezone);
  return {
    workspaceId,
    accounts: accounts.map(
      (a): ComposerAccount => ({
        socialAccountId: a.socialAccountId,
        network: a.network as NetworkId,
        name: a.name,
        username: a.username,
        avatar: a.avatar,
        needsReconnect: a.needsReconnect,
        // Never ship tokens or encrypted secrets to the browser.
        meta: safeMeta(a.meta),
      }),
    ),
    library: mediaRows.map(rowToMedia),
    snippets: snippets.map(({ snippetId, kind, name, body }) => ({ snippetId, kind, name, body })),
    tags: tags.map(({ tagId, name, color }) => ({ tagId, name, color })),
    nextSlot: nextSlot?.toISOString() ?? null,
    timezone,
  };
}

/** Media referenced by a post that isn't in the recent-library window. */
export async function mediaForIds(ids: string[], known: Set<string>): Promise<ComposerMedia[]> {
  const missing = ids.filter((id) => !known.has(id));
  if (!missing.length) return [];
  const rows = await db.select().from(schema.media).where(inArray(schema.media.mediaId, missing));
  return rows.map(rowToMedia);
}
