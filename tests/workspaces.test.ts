/**
 * Workspace rules against a real Postgres (compose.dev.yml). Skipped when
 * DATABASE_URL isn't reachable.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_KEY ??= "test-key";
process.env.DATABASE_URL ??= "postgres://posty:posty@localhost:5432/posty";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));

const { db, schema } = await import("@/lib/db");
const { activeWorkspaceId } = await import("@/lib/workspaces");
const { encrypt } = await import("@/lib/crypto");
const { moveAccountTo, saveConnected } = await import("@/lib/accounts");
const { publishedWithMetrics } = await import("@/lib/analytics");
const { createIdeaGroup, ideaPostInput, listIdeaGroups, listIdeas, saveIdea } = await import("@/lib/ideas");
const { nextQueueSlot, retryFailedTargets, savePostAs, tagIdsFor } = await import("@/lib/posts");

const reachable = await db.execute(sql`select 1`).then(() => true, () => false);

const user = { userId: "", email: "workspaces-test@example.test", name: "Test", timezone: "UTC" };

async function makeWorkspace(name: string) {
  const [row] = await db.insert(schema.workspaces).values({ name }).returning();
  return row.workspaceId;
}

async function makeAccount(workspaceId: string, id: string) {
  const [row] = await db
    .insert(schema.socialAccounts)
    .values({ workspaceId, network: "mastodon", providerAccountId: `ws-test-${id}`, name: id, accessTokenEnc: encrypt("t") })
    .returning();
  return row.socialAccountId;
}

async function makeMedia(workspaceId: string) {
  const [row] = await db
    .insert(schema.media)
    .values({ workspaceId, fileName: `${crypto.randomUUID()}.png`, originalName: "x.png", mime: "image/png", sizeBytes: 1 })
    .returning();
  return row.mediaId;
}

describe.runIf(reachable)("workspaces", () => {
  let a = "";
  let b = "";
  let accountA = "";
  let accountB = "";
  let mediaB = "";
  let tagB = "";

  const draft = (extra: object = {}) =>
    savePostAs(user, { workspaceId: a, parts: [{ text: "hi", mediaIds: [] }], targets: [], tagIds: [], mode: "draft", ...extra });
  const target = (socialAccountId: string, override: { parts: { text: string; mediaIds: string[] }[] } | null = null) => ({
    socialAccountId,
    override,
    options: {},
  });

  beforeAll(async () => {
    const [row] = await db
      .insert(schema.users)
      .values({ email: user.email, name: user.name, passwordHash: "x" })
      .returning();
    user.userId = row.userId;
    a = await makeWorkspace(`ws-test-a-${crypto.randomUUID()}`);
    b = await makeWorkspace(`ws-test-b-${crypto.randomUUID()}`);
    accountA = await makeAccount(a, "a");
    accountB = await makeAccount(b, "b");
    mediaB = await makeMedia(b);
    [tagB] = await tagIdsFor(["shared-name"], b);
    await db.insert(schema.queueSlots).values(
      [a, b].flatMap((workspaceId) =>
        [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ workspaceId, dayOfWeek, time: "09:00" })),
      ),
    );
  });

  afterAll(async () => {
    const ids = [a, b];
    await db.delete(schema.posts).where(inArray(schema.posts.workspaceId, ids));
    await db.delete(schema.ideas).where(inArray(schema.ideas.workspaceId, ids));
    await db.delete(schema.socialAccounts).where(inArray(schema.socialAccounts.workspaceId, ids));
    await db.delete(schema.media).where(inArray(schema.media.workspaceId, ids));
    await db.delete(schema.workspaces).where(inArray(schema.workspaces.workspaceId, ids));
    await db.delete(schema.users).where(eq(schema.users.userId, user.userId));
  });

  describe("the open workspace", () => {
    it("uses the cookie, and falls back to the oldest for no cookie or a deleted workspace", async () => {
      cookie = undefined;
      const oldest = await activeWorkspaceId();
      // Sorts first by name, so an alphabetical fallback would jump to it.
      const newer = await makeWorkspace(`!ws-test-${crypto.randomUUID()}`);
      try {
        expect(await activeWorkspaceId()).toBe(oldest);
        cookie = newer;
        expect(await activeWorkspaceId()).toBe(newer);
        cookie = crypto.randomUUID();
        expect(await activeWorkspaceId()).toBe(oldest);
      } finally {
        cookie = undefined;
        await db.delete(schema.workspaces).where(eq(schema.workspaces.workspaceId, newer));
      }
    });
  });

  describe("a post can't cross workspaces", () => {
    it("rejects another workspace's account, even for a draft", async () => {
      const res = await draft({ targets: [target(accountB)] });
      expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/account/) });
    });

    it("rejects another workspace's tag", async () => {
      const res = await draft({ tagIds: [tagB] });
      expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/tag/) });
    });

    it("rejects another workspace's media, in the post or one account's override", async () => {
      const inPost = await draft({ parts: [{ text: "hi", mediaIds: [mediaB] }] });
      expect(inPost).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown media/) });
      const inOverride = await draft({ targets: [target(accountA, { parts: [{ text: "x", mediaIds: [mediaB] }] })] });
      expect(inOverride).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown media/) });
    });

    it("won't save a post into a different workspace", async () => {
      const created = await draft();
      if (!created.ok) throw new Error(created.error);
      const res = await draft({ workspaceId: b, postId: created.postId });
      expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/another workspace/) });
    });
  });

  describe("queue", () => {
    it("fills each workspace's slots independently", async () => {
      const first = await draft({ mode: "queue", targets: [target(accountA)] });
      const other = await draft({ workspaceId: b, mode: "queue", targets: [target(accountB)] });
      const second = await draft({ mode: "queue", targets: [target(accountA)] });
      if (!first.ok || !other.ok || !second.ok) throw new Error("queueing failed");
      expect(other.scheduledAt).toBe(first.scheduledAt);
      expect(second.scheduledAt).not.toBe(first.scheduledAt);
      expect((await nextQueueSlot(b, "UTC"))?.toISOString()).toBe(second.scheduledAt);
    });
  });

  describe("tags", () => {
    it("keeps the same name separately per workspace", async () => {
      const [tagA] = await tagIdsFor(["shared-name"], a);
      expect(tagA).not.toBe(tagB);
      expect(await tagIdsFor(["shared-name"], b)).toEqual([tagB]);
    });
  });

  describe("ideas", () => {
    it("lists only its own workspace's ideas and groups, and allows the same group name", async () => {
      const groupA = await createIdeaGroup(a, "ws-test-column");
      const groupB = await createIdeaGroup(b, "ws-test-column");
      expect(groupA.ideaGroupId).not.toBe(groupB.ideaGroupId);
      expect((await listIdeaGroups(a)).map((g) => g.ideaGroupId)).toEqual([groupA.ideaGroupId]);
      const saved = await saveIdea({ workspaceId: a, title: "only in a" });
      if (!saved.ok) throw new Error(saved.error);
      expect((await listIdeas({ workspaceId: a })).map((i) => i.ideaId)).toContain(saved.ideaId);
      expect((await listIdeas({ workspaceId: b })).map((i) => i.ideaId)).not.toContain(saved.ideaId);
    });

    it("rejects another workspace's media and group", async () => {
      const groupB = await createIdeaGroup(b, "ws-test-other");
      expect(await saveIdea({ workspaceId: a, title: "x", mediaIds: [mediaB] })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/Unknown media/),
      });
      expect(await saveIdea({ workspaceId: a, title: "x", ideaGroupId: groupB.ideaGroupId })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/Unknown idea group/),
      });
    });

    it("checks an update against the idea's own workspace", async () => {
      const groupB = await createIdeaGroup(b, "ws-test-update");
      const saved = await saveIdea({ workspaceId: a, title: "x" });
      if (!saved.ok) throw new Error(saved.error);
      expect(await saveIdea({ ideaGroupId: groupB.ideaGroupId }, saved.ideaId)).toMatchObject({ ok: false });
    });

    it("turns into a post that targets only its workspace's accounts", async () => {
      const saved = await saveIdea({ workspaceId: a, title: "x", networks: ["mastodon"] });
      if (!saved.ok) throw new Error(saved.error);
      const input = await ideaPostInput(saved.ideaId);
      expect(input?.workspaceId).toBe(a);
      expect(input?.targets.map((t) => t.socialAccountId)).toEqual([accountA]);
    });
  });

  describe("connecting", () => {
    const connected = (id: string, accessToken = "fresh") => ({ providerAccountId: `ws-test-${id}`, name: id, accessToken });

    it("adds a new account to the workspace it was connected from", async () => {
      const res = await saveConnected("mastodon", [connected("new")], b);
      expect(res).toMatchObject({ added: 1, refreshed: 0, elsewhere: 0 });
      const [row] = await db
        .select()
        .from(schema.socialAccounts)
        .where(eq(schema.socialAccounts.providerAccountId, "ws-test-new"));
      expect(row.workspaceId).toBe(b);
    });

    it("leaves an account in another workspace completely alone", async () => {
      const id = await makeAccount(a, "paused");
      await db.update(schema.socialAccounts).set({ isActive: false }).where(eq(schema.socialAccounts.socialAccountId, id));
      const res = await saveConnected("mastodon", [connected("paused")], b);
      expect(res).toMatchObject({ added: 0, refreshed: 0, elsewhere: 1 });
      const [row] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.socialAccountId, id));
      expect(row).toMatchObject({ workspaceId: a, isActive: false });
    });

    it("refreshes an account reconnected from its own workspace", async () => {
      await makeAccount(a, "mine");
      expect(await saveConnected("mastodon", [connected("mine")], a)).toMatchObject({ added: 0, refreshed: 1, elsewhere: 0 });
    });
  });

  describe("moving an account", () => {
    it("is refused while a draft or scheduled post uses it, then works", async () => {
      const id = await makeAccount(a, "mover");
      const post = await draft({ targets: [target(id)] });
      if (!post.ok) throw new Error(post.error);
      expect((await moveAccountTo(id, b)).error).toMatch(/1 draft or scheduled post/);
      await db.delete(schema.posts).where(eq(schema.posts.postId, post.postId));
      expect(await moveAccountTo(id, b)).toEqual({});
      const [row] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.socialAccountId, id));
      expect(row.workspaceId).toBe(b);
    });

    it("keeps history with the old workspace, and retry skips the moved account", async () => {
      const stays = await makeAccount(a, "stays");
      const moves = await makeAccount(a, "moves");
      const post = await draft({ targets: [target(stays), target(moves)] });
      if (!post.ok) throw new Error(post.error);
      const { postId } = post;
      await db.update(schema.posts).set({ status: "failed" }).where(eq(schema.posts.postId, postId));
      await db.update(schema.postTargets).set({ status: "failed" }).where(eq(schema.postTargets.postId, postId));
      expect(await moveAccountTo(moves, b)).toEqual({});

      expect(await retryFailedTargets(postId)).toEqual({});
      const rows = await db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, postId));
      expect(rows.find((t) => t.socialAccountId === stays)?.status).toBe("pending");
      expect(rows.find((t) => t.socialAccountId === moves)?.status).toBe("failed");
    });

    it("won't retry when every failed account has moved", async () => {
      const id = await makeAccount(a, "gone");
      const post = await draft({ targets: [target(id)] });
      if (!post.ok) throw new Error(post.error);
      await db.update(schema.posts).set({ status: "failed" }).where(eq(schema.posts.postId, post.postId));
      await db.update(schema.postTargets).set({ status: "failed" }).where(eq(schema.postTargets.postId, post.postId));
      expect(await moveAccountTo(id, b)).toEqual({});
      expect((await retryFailedTargets(post.postId)).error).toMatch(/another workspace/);
      const [row] = await db.select().from(schema.posts).where(eq(schema.posts.postId, post.postId));
      expect(row.status).toBe("failed");
    });
  });

  describe("analytics", () => {
    it("counts a post in the workspace it was written in", async () => {
      const post = await draft({ targets: [target(accountA)] });
      if (!post.ok) throw new Error(post.error);
      await db.update(schema.postTargets).set({ status: "published" }).where(eq(schema.postTargets.postId, post.postId));
      const inA = await publishedWithMetrics({ workspaceId: a });
      const inB = await publishedWithMetrics({ workspaceId: b });
      expect(inA.map((r) => r.postId)).toContain(post.postId);
      expect(inB.map((r) => r.postId)).not.toContain(post.postId);
    });
  });
});
