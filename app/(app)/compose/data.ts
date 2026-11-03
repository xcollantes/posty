import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { NetworkId } from "@/lib/networks/catalog";
import { rowToMedia } from "@/components/composer/media";
import type { ComposerAccount, ComposerMedia } from "@/components/composer/types";

const SAFE_META = ["boards", "maxChars", "maxMedia", "subscriptionType", "handle"];

export async function composerData() {
  const [accounts, mediaRows, snippets, tags, [{ slots }]] = await Promise.all([
    db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.isActive, true))
      .orderBy(asc(schema.socialAccounts.network), asc(schema.socialAccounts.name)),
    db.select().from(schema.media).orderBy(desc(schema.media.createdAt)).limit(300),
    db.select().from(schema.snippets).orderBy(asc(schema.snippets.name)),
    db.select().from(schema.tags).orderBy(asc(schema.tags.name)),
    db.select({ slots: count() }).from(schema.queueSlots),
  ]);
  return {
    accounts: accounts.map(
      (a): ComposerAccount => ({
        socialAccountId: a.socialAccountId,
        network: a.network as NetworkId,
        name: a.name,
        username: a.username,
        avatar: a.avatar,
        needsReconnect: a.needsReconnect,
        // Never ship tokens or encrypted secrets to the browser.
        meta: Object.fromEntries(Object.entries(a.meta).filter(([k]) => SAFE_META.includes(k))),
      }),
    ),
    library: mediaRows.map(rowToMedia),
    snippets: snippets.map(({ snippetId, kind, name, body }) => ({ snippetId, kind, name, body })),
    tags: tags.map(({ tagId, name, color }) => ({ tagId, name, color })),
    hasQueue: slots > 0,
  };
}

/** Media referenced by a post that isn't in the recent-library window. */
export async function mediaForIds(ids: string[], known: Set<string>): Promise<ComposerMedia[]> {
  const missing = ids.filter((id) => !known.has(id));
  if (!missing.length) return [];
  const rows = await db.select().from(schema.media).where(inArray(schema.media.mediaId, missing));
  return rows.map(rowToMedia);
}
