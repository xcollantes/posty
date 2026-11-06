import { and, asc, desc, eq, exists, inArray, isNull, not, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { unknownMedia } from "@/lib/media";
import type { TargetInput } from "@/lib/posts";
import { tagIdsFor } from "@/lib/posts";

export type IdeaInput = {
  /** Required to create one. An update stays in the idea's own workspace. */
  workspaceId?: string;
  title?: string;
  text?: string;
  mediaIds?: string[];
  networks?: string[];
  tags?: string[];
  ideaGroupId?: string | null;
  targetAt?: string | null;
};

export type IdeaFilter = {
  workspaceId: string;
  /** null = only ideas in no group. */
  ideaGroupId?: string | null;
  tags?: string[];
  /** With `tags`, also return ideas that have no tags at all. */
  includeUntagged?: boolean;
  limit?: number;
  offset?: number;
};

const hasTag = (tagNames?: string[]) =>
  exists(
    db
      .select({ tagId: schema.ideaTags.tagId })
      .from(schema.ideaTags)
      .innerJoin(schema.tags, eq(schema.tags.tagId, schema.ideaTags.tagId))
      .where(
        and(eq(schema.ideaTags.ideaId, schema.ideas.ideaId), tagNames && inArray(schema.tags.name, tagNames)),
      ),
  );

/** Ideas, newest first, each with its tags. */
export async function listIdeas(filter: IdeaFilter) {
  const { ideaGroupId, tags, includeUntagged } = filter;
  const rows = await db
    .select()
    .from(schema.ideas)
    .where(
      and(
        eq(schema.ideas.workspaceId, filter.workspaceId),
        ideaGroupId === null
          ? isNull(schema.ideas.ideaGroupId)
          : ideaGroupId
            ? eq(schema.ideas.ideaGroupId, ideaGroupId)
            : undefined,
        tags?.length ? (includeUntagged ? or(hasTag(tags), not(hasTag())) : hasTag(tags)) : undefined,
      ),
    )
    .orderBy(desc(schema.ideas.updatedAt))
    .limit(filter.limit ?? 500)
    .offset(filter.offset ?? 0);
  const ids = rows.map((r) => r.ideaId);
  const tagRows = ids.length
    ? await db
        .select({ ideaId: schema.ideaTags.ideaId, name: schema.tags.name, color: schema.tags.color })
        .from(schema.ideaTags)
        .innerJoin(schema.tags, eq(schema.tags.tagId, schema.ideaTags.tagId))
        .where(inArray(schema.ideaTags.ideaId, ids))
    : [];
  return rows.map((r) => ({
    ...r,
    tags: tagRows.filter((t) => t.ideaId === r.ideaId).map(({ name, color }) => ({ name, color })),
  }));
}

export const listIdeaGroups = (workspaceId: string) =>
  db
    .select()
    .from(schema.ideaGroups)
    .where(eq(schema.ideaGroups.workspaceId, workspaceId))
    .orderBy(asc(schema.ideaGroups.createdAt), asc(schema.ideaGroups.name));

/** Create an idea, or update one when `ideaId` is given. Omitted fields keep their values. */
export async function saveIdea(
  input: IdeaInput,
  ideaId?: string,
): Promise<{ ok: true; ideaId: string } | { ok: false; error: string }> {
  if (!ideaId && !input.title?.trim() && !input.text?.trim() && !input.mediaIds?.length) {
    return { ok: false, error: "Add a title, some text or a file" };
  }
  const [existing] = ideaId
    ? await db.select({ workspaceId: schema.ideas.workspaceId }).from(schema.ideas).where(eq(schema.ideas.ideaId, ideaId))
    : [];
  const workspaceId = ideaId ? existing?.workspaceId : input.workspaceId;
  if (!workspaceId) return { ok: false, error: "Idea not found" };
  const missing = await unknownMedia(input.mediaIds ?? [], workspaceId);
  if (missing.length) return { ok: false, error: `Unknown media: ${missing.join(", ")}` };
  if (input.ideaGroupId) {
    const [group] = await db
      .select({ id: schema.ideaGroups.ideaGroupId })
      .from(schema.ideaGroups)
      .where(and(eq(schema.ideaGroups.ideaGroupId, input.ideaGroupId), eq(schema.ideaGroups.workspaceId, workspaceId)));
    if (!group) return { ok: false, error: "Unknown idea group" };
  }
  const tagIds = input.tags && (await tagIdsFor(input.tags, workspaceId));
  const values = {
    title: input.title,
    text: input.text,
    mediaIds: input.mediaIds,
    networks: input.networks,
    ideaGroupId: input.ideaGroupId,
    targetAt: input.targetAt === undefined ? undefined : input.targetAt ? new Date(input.targetAt) : null,
  };
  const savedId = await db.transaction(async (tx) => {
    const [row] = ideaId
      ? await tx
          .update(schema.ideas)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(schema.ideas.ideaId, ideaId))
          .returning({ ideaId: schema.ideas.ideaId })
      : await tx.insert(schema.ideas).values({ ...values, workspaceId }).returning({ ideaId: schema.ideas.ideaId });
    if (!row) return null;
    if (tagIds) {
      await tx.delete(schema.ideaTags).where(eq(schema.ideaTags.ideaId, row.ideaId));
      if (tagIds.length) await tx.insert(schema.ideaTags).values(tagIds.map((tagId) => ({ ideaId: row.ideaId, tagId })));
    }
    return row.ideaId;
  });
  return savedId ? { ok: true, ideaId: savedId } : { ok: false, error: "Idea not found" };
}

export async function deleteIdea(ideaId: string): Promise<boolean> {
  const rows = await db.delete(schema.ideas).where(eq(schema.ideas.ideaId, ideaId)).returning({ ideaId: schema.ideas.ideaId });
  return rows.length > 0;
}

/** Create a group, or return the one that already has this name. */
export async function createIdeaGroup(workspaceId: string, name: string) {
  const [row] = await db
    .insert(schema.ideaGroups)
    .values({ workspaceId, name })
    .onConflictDoUpdate({ target: [schema.ideaGroups.workspaceId, schema.ideaGroups.name], set: { name } })
    .returning();
  return row;
}

export async function deleteIdeaGroup(ideaGroupId: string): Promise<boolean> {
  const rows = await db
    .delete(schema.ideaGroups)
    .where(eq(schema.ideaGroups.ideaGroupId, ideaGroupId))
    .returning({ ideaGroupId: schema.ideaGroups.ideaGroupId });
  return rows.length > 0;
}

/**
 * What a post made from this idea starts with. Falls back to the title so a
 * title-only idea isn't lost; targets are the active accounts on its networks.
 */
export async function ideaPostInput(ideaId: string) {
  const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.ideaId, ideaId));
  if (!idea) return null;
  const [tags, accounts] = await Promise.all([
    db.select({ tagId: schema.ideaTags.tagId }).from(schema.ideaTags).where(eq(schema.ideaTags.ideaId, ideaId)),
    idea.networks.length
      ? db
          .select({ socialAccountId: schema.socialAccounts.socialAccountId })
          .from(schema.socialAccounts)
          .where(
            and(
              eq(schema.socialAccounts.workspaceId, idea.workspaceId),
              inArray(schema.socialAccounts.network, idea.networks),
              eq(schema.socialAccounts.isActive, true),
            ),
          )
      : [],
  ]);
  return {
    workspaceId: idea.workspaceId,
    parts: [{ text: idea.text || idea.title, mediaIds: idea.mediaIds }],
    tagIds: tags.map((t) => t.tagId),
    targets: accounts.map((a): TargetInput => ({ socialAccountId: a.socialAccountId, override: null, options: {} })),
  };
}
