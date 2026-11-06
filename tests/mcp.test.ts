/**
 * MCP tools end to end: JSON-RPC through the real route handler against a real
 * Postgres (compose.dev.yml). Skipped when DATABASE_URL isn't reachable.
 */
import { eq, inArray, like, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.APP_KEY ??= "test-key";
process.env.DATABASE_URL ??= "postgres://posty:posty@localhost:5432/posty";
process.env.MCP_TOKEN = "test-token";
process.env.ADMIN_EMAIL = "mcp-test@example.test";

const { db, schema } = await import("@/lib/db");
const { encrypt } = await import("@/lib/crypto");
const { readUploadGrant } = await import("@/lib/media");
const { POST } = await import("@/app/api/mcp/route");

const reachable = await db.execute(sql`select 1`).then(() => true, () => false);

const future = (hours = 24) => new Date(Date.now() + hours * 3_600_000).toISOString();
const past = () => new Date(Date.now() - 3_600_000).toISOString();

async function rpc(token: string, name: string, args: object) {
  const response = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  return response;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(name: string, args: object = {}): Promise<{ isError: boolean; text: string; data: any }> {
  const body = await (await rpc("test-token", name, args)).text();
  const frame = body.split("\n").find((line) => line.startsWith("data:"));
  const { result, error } = JSON.parse(frame ? frame.slice(5) : body);
  if (error) return { isError: true, text: error.message, data: null };
  const text = result.content[0].text as string;
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { isError: Boolean(result.isError), text, data };
}

async function ok(name: string, args: object = {}) {
  const result = await call(name, args);
  expect(result.isError, result.text).toBe(false);
  return result.data;
}

async function refused(name: string, args: object, pattern: RegExp) {
  const result = await call(name, args);
  expect(result.isError, `expected ${name} to be refused`).toBe(true);
  expect(result.text).toMatch(pattern);
}

describe.runIf(reachable)("MCP tools", () => {
  let userId = "";
  let mastodon = "";
  let pinterest = "";
  let imageId = "";

  const makeAccount = async (network: string, id: string, meta: object) => {
    const [row] = await db
      .insert(schema.socialAccounts)
      .values({
        network,
        providerAccountId: `mcp-test-${id}`,
        name: `MCP ${network}`,
        accessTokenEnc: encrypt("secret-access-token"),
        meta: { ...meta },
      })
      .returning();
    return row.socialAccountId;
  };

  const target = async (postId: string) => {
    const [row] = await db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, postId));
    return row;
  };

  const cleanup = async () => {
    const posts = db.select({ id: schema.posts.postId }).from(schema.posts).where(eq(schema.posts.createdBy, userId));
    await db.delete(schema.posts).where(inArray(schema.posts.postId, posts));
    await db.delete(schema.ideas).where(or(like(schema.ideas.title, "mcp-test%"), like(schema.ideas.text, "mcp-test%")));
    await db.delete(schema.ideaGroups).where(like(schema.ideaGroups.name, "mcp-test%"));
    await db.delete(schema.tags).where(like(schema.tags.name, "mcp-test%"));
    await db.delete(schema.snippets).where(like(schema.snippets.name, "mcp-test%"));
    await db.delete(schema.media).where(like(schema.media.originalName, "mcp-test%"));
  };

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({ email: "mcp-test@example.test", name: "MCP Test", passwordHash: "x", timezone: "America/Los_Angeles" })
      .onConflictDoNothing();
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, "mcp-test@example.test"));
    userId = user.userId;
    await db.delete(schema.socialAccounts).where(like(schema.socialAccounts.providerAccountId, "mcp-test-%"));
    mastodon = await makeAccount("mastodon", "m", { appPasswordEnc: "secret-in-meta", maxChars: 1000 });
    pinterest = await makeAccount("pinterest", "p", { boards: [{ value: "b1", label: "Recipes" }] });
  });

  beforeEach(async () => {
    await cleanup();
    const [media] = await db
      .insert(schema.media)
      .values({
        fileName: `${crypto.randomUUID()}.png`,
        originalName: "mcp-test.png",
        mime: "image/png",
        sizeBytes: 10,
        width: 100,
        height: 100,
      })
      .returning();
    imageId = media.mediaId;
  });

  afterAll(async () => {
    await cleanup();
    await db.delete(schema.socialAccounts).where(like(schema.socialAccounts.providerAccountId, "mcp-test-%"));
    await db.delete(schema.users).where(eq(schema.users.userId, userId));
  });

  const draft = async (extra: object = {}) =>
    (await ok("create_post", { parts: [{ text: "hello" }], targets: [{ accountId: mastodon }], ...extra })).postId as string;

  describe("auth", () => {
    it("rejects the wrong token", async () => {
      expect((await rpc("wrong", "list_accounts", {})).status).toBe(401);
    });
  });

  describe("list_accounts", () => {
    it("returns limits, options and boards with no secrets", async () => {
      const result = await call("list_accounts");
      expect(result.isError).toBe(false);
      expect(result.text).not.toMatch(/secret|accessToken|access_token|appPassword/i);
      expect(result.data.timezone).toBe("America/Los_Angeles");
      expect(result.data.now).toMatch(/[-+]\d\d:\d\d$/);
      const accounts = result.data.accounts as any[];
      const m = accounts.find((a) => a.accountId === mastodon);
      expect(m.limits.maxChars).toBe(1000);
      expect(m.limits.threads).toBe(true);
      const p = accounts.find((a) => a.accountId === pinterest);
      expect(p.options.find((o: any) => o.key === "boardId").choices).toEqual([{ value: "b1", label: "Recipes" }]);
    });
  });

  describe("create_post", () => {
    it("rejects options the network would ignore, instead of posting publicly", async () => {
      await refused("create_post", { parts: [{ text: "hi" }], targets: [{ accountId: mastodon, options: { privacy: "private" } }] }, /unknown option "privacy"/);
      await refused("create_post", { parts: [{ text: "hi" }], targets: [{ accountId: mastodon, options: { visibility: "secret" } }] }, /visibility must be one of/);
    });

    it("rejects ids that don't exist", async () => {
      const unknown = crypto.randomUUID();
      await refused("create_post", { parts: [{ text: "hi" }], targets: [{ accountId: unknown }] }, /Unknown accountId/);
      await refused("create_post", { parts: [{ text: "hi", mediaIds: [unknown] }] }, new RegExp(`Unknown media: ${unknown}`));
      await refused("create_post", { parts: [{ text: "hi" }], targets: [{ accountId: mastodon, parts: [{ text: "x", mediaIds: [unknown] }] }] }, /Unknown media/);
    });

    it("rejects an empty per-account override, which would publish nothing", async () => {
      await refused("create_post", { parts: [{ text: "hi" }], targets: [{ accountId: mastodon, parts: [] }] }, /parts/);
    });

    it("rejects past times and a missing time", async () => {
      await refused("create_post", { parts: [{ text: "hi" }], targets: [{ accountId: mastodon }], scheduledAt: past() }, /in the past/);
      await refused("create_post", { parts: [{ text: "hi" }], targets: [{ accountId: mastodon }], mode: "schedule" }, /needs scheduledAt/);
    });

    it("needs content", async () => {
      await refused("create_post", { targets: [{ accountId: mastodon }] }, /Pass parts/);
    });

    it("warns about a draft that couldn't be scheduled yet", async () => {
      const result = await ok("create_post", { parts: [{ text: "x".repeat(1001) }], targets: [{ accountId: mastodon }] });
      expect(result.status).toBe("draft");
      expect(result.warnings[0]).toMatch(/1001\/1000/);
    });

    it("schedules when given a time, with no mode", async () => {
      const at = future();
      const result = await ok("create_post", { parts: [{ text: "hi" }], targets: [{ accountId: mastodon }], scheduledAt: at });
      expect(result.status).toBe("scheduled");
      expect(new Date(result.scheduledAt).getTime()).toBe(new Date(at).getTime());
    });

    it("attaches media and creates tags by name", async () => {
      const { postId } = await ok("create_post", {
        parts: [{ text: "hi", mediaIds: [imageId] }],
        targets: [{ accountId: mastodon }],
        tags: ["mcp-test-launch", "mcp-test-launch"],
      });
      const post = await ok("get_post", { postId });
      expect(post.parts[0].mediaIds).toEqual([imageId]);
      expect(post.media[0].mediaId).toBe(imageId);
      expect(post.media[0].url).toMatch(/\/media\/.*\.png$/);
      expect(post.media[0].path).toBeUndefined();
      expect(post.tags).toEqual(["mcp-test-launch"]);
    });

    it("gives parallel queue calls different slots", async () => {
      const slots = await ok("add_queue_slots", { days: [0, 1, 2, 3, 4, 5, 6], time: "07:13" });
      try {
        const results = await Promise.all(
          Array.from({ length: 6 }, (_, i) =>
            ok("create_post", { parts: [{ text: `q${i}` }], targets: [{ accountId: mastodon }], mode: "queue" }),
          ),
        );
        expect(new Set(results.map((r) => r.scheduledAt)).size).toBe(6);
      } finally {
        await db.delete(schema.queueSlots).where(inArray(schema.queueSlots.queueSlotId, slots.map((s: any) => s.queueSlotId)));
      }
    });
  });

  describe("edit_post", () => {
    it("keeps everything you omit", async () => {
      const at = future();
      const { postId } = await ok("create_post", {
        parts: [{ text: "before", mediaIds: [imageId] }],
        targets: [{ accountId: mastodon, options: { visibility: "unlisted" }, parts: [{ text: "just for mastodon" }] }],
        tags: ["mcp-test-keep"],
        scheduledAt: at,
      });
      await ok("edit_post", { postId, parts: [{ text: "after", mediaIds: [imageId] }] });
      const post = await ok("get_post", { postId });
      expect(post.parts[0].text).toBe("after");
      expect(post.status).toBe("scheduled");
      expect(new Date(post.scheduledAt).getTime()).toBe(new Date(at).getTime());
      expect(post.tags).toEqual(["mcp-test-keep"]);
      expect(post.targets[0].options).toEqual({ visibility: "unlisted" });
      expect(post.targets[0].parts[0].text).toBe("just for mastodon");
    });

    it("keeps the text when only the time changes", async () => {
      const postId = await draft();
      const at = future(48);
      const result = await ok("edit_post", { postId, scheduledAt: at });
      expect(result.status).toBe("scheduled");
      expect((await ok("get_post", { postId })).parts[0].text).toBe("hello");
    });

    it("doesn't schedule a draft nobody asked to schedule", async () => {
      const postId = await draft();
      expect((await ok("edit_post", { postId, parts: [{ text: "new" }] })).status).toBe("draft");
    });

    it("won't re-send an overdue post by saving it", async () => {
      const postId = await draft({ scheduledAt: future() });
      await db.update(schema.posts).set({ scheduledAt: new Date(past()) }).where(eq(schema.posts.postId, postId));
      await refused("edit_post", { postId, parts: [{ text: "new" }] }, /in the past/);
    });

    it("won't touch a post with a live target, which would publish it twice", async () => {
      const postId = await draft({ scheduledAt: future() });
      await db.update(schema.postTargets).set({ status: "published", providerPostId: "live" }).where(eq(schema.postTargets.postId, postId));
      await refused("edit_post", { postId, parts: [{ text: "new" }] }, /already went out/);
      const row = await target(postId);
      expect(row.status).toBe("published");
    });

    it("won't touch a half-published thread", async () => {
      const postId = await draft({ scheduledAt: future() });
      await db.update(schema.postTargets).set({ status: "failed", providerPostId: "first-part" }).where(eq(schema.postTargets.postId, postId));
      await db.update(schema.posts).set({ status: "failed" }).where(eq(schema.posts.postId, postId));
      await refused("edit_post", { postId, parts: [{ text: "new" }] }, /already went out/);
    });

    it("won't touch a post that's publishing", async () => {
      const postId = await draft({ scheduledAt: future() });
      await db.update(schema.postTargets).set({ status: "publishing" }).where(eq(schema.postTargets.postId, postId));
      await refused("edit_post", { postId, parts: [{ text: "new" }] }, /publishing right now/);
    });
  });

  describe("publish_post", () => {
    it("queues a draft to go out now, keeping its targets", async () => {
      const postId = await draft({ targets: [{ accountId: mastodon, options: { visibility: "private" } }] });
      const before = Date.now();
      const result = await ok("publish_post", { postId });
      expect(result.status).toBe("scheduled");
      expect(new Date(result.scheduledAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
      const row = await target(postId);
      expect(row.status).toBe("pending");
      expect(row.options).toEqual({ visibility: "private" });
    });

    it("validates first, and refuses other statuses", async () => {
      const tooLong = await draft({ parts: [{ text: "x".repeat(1001) }] });
      await refused("publish_post", { postId: tooLong }, /1001\/1000/);
      const failed = await draft();
      await db.update(schema.posts).set({ status: "failed" }).where(eq(schema.posts.postId, failed));
      await refused("publish_post", { postId: failed }, /retry_post/);
    });
  });

  describe("retry_post", () => {
    it("refuses a draft, which it would otherwise publish", async () => {
      const postId = await draft();
      await refused("retry_post", { postId }, /Only failed posts/);
      expect((await ok("get_post", { postId })).status).toBe("draft");
    });

    it("refuses a half-published thread", async () => {
      const postId = await draft();
      await db.update(schema.posts).set({ status: "failed" }).where(eq(schema.posts.postId, postId));
      await db.update(schema.postTargets).set({ status: "failed", providerPostId: "first", url: "https://x.test/1" }).where(eq(schema.postTargets.postId, postId));
      await refused("retry_post", { postId }, /already live \(https:\/\/x\.test\/1\)/);
    });

    it("re-queues a plain failure", async () => {
      const postId = await draft();
      await db.update(schema.posts).set({ status: "failed" }).where(eq(schema.posts.postId, postId));
      await db.update(schema.postTargets).set({ status: "failed", error: "boom" }).where(eq(schema.postTargets.postId, postId));
      await ok("retry_post", { postId });
      const row = await target(postId);
      expect(row.status).toBe("pending");
      expect(row.error).toBeNull();
    });
  });

  describe("delete_post", () => {
    it("refuses while publishing, then deletes", async () => {
      const postId = await draft();
      await db.update(schema.postTargets).set({ status: "publishing" }).where(eq(schema.postTargets.postId, postId));
      await refused("delete_post", { postId }, /publishing right now/);
      await db.update(schema.postTargets).set({ status: "pending" }).where(eq(schema.postTargets.postId, postId));
      await ok("delete_post", { postId });
      await refused("get_post", { postId }, /not found/);
      await refused("delete_post", { postId }, /not found/);
    });
  });

  describe("list_posts", () => {
    it("filters by status, account, tag and date, and pages", async () => {
      const a = await draft({ tags: ["mcp-test-a"] });
      const b = await draft({ targets: [{ accountId: pinterest, options: { boardId: "b1" } }], scheduledAt: undefined });
      const ids = async (args: object) => (await ok("list_posts", { limit: 100, ...args })).posts.map((p: any) => p.postId);
      expect(await ids({ status: ["draft"] })).toEqual(expect.arrayContaining([a, b]));
      expect(await ids({ status: ["published"] })).not.toContain(a);
      expect(await ids({ accountIds: [pinterest] })).toEqual([b]);
      expect(await ids({ tags: ["mcp-test-a"] })).toEqual([a]);
      expect(await ids({ createdTo: past() })).not.toContain(a);
      const page = await ok("list_posts", { limit: 1, status: ["draft"] });
      expect(page.nextOffset).toBe(1);
    });
  });

  describe("get_post_metrics", () => {
    it("totals the latest snapshot, keeping unreported numbers null", async () => {
      const postId = await draft({ tags: ["mcp-test-metrics"] });
      await db.update(schema.posts).set({ status: "published" }).where(eq(schema.posts.postId, postId));
      await db
        .update(schema.postTargets)
        .set({ status: "published", publishedAt: new Date(), providerPostId: "p" })
        .where(eq(schema.postTargets.postId, postId));
      const { postTargetId } = await target(postId);
      await db.insert(schema.postMetrics).values([
        { postTargetId, likes: 1, fetchedAt: new Date(Date.now() - 86_400_000) },
        { postTargetId, likes: 5, comments: 2 },
      ]);
      const totals = await ok("get_post_metrics", { from: past(), to: future(), tags: ["mcp-test-metrics"] });
      expect(totals.totals).toMatchObject({ posts: 1, likes: 5, comments: 2, views: null });
      expect(totals.byNetwork.mastodon.likes).toBe(5);
      expect(totals.metricsUpdatedAt).not.toBeNull();
      const empty = await ok("get_post_metrics", { from: past(), to: future(), tags: ["mcp-test-no-such-tag"] });
      expect(empty.totals.posts).toBe(0);
      const post = await ok("get_post", { postId, includeMetrics: true });
      expect(post.targets[0].metrics.likes).toBe(5);
      expect((await ok("get_post", { postId })).targets[0].metrics).toBeUndefined();
    });
  });

  describe("media", () => {
    it("refuses internal URLs and explains bad ones", async () => {
      await refused("upload_media_from_url", { url: "http://169.254.169.254/latest/meta-data/" }, /not a public address/);
      await refused("upload_media_from_url", { url: "http://localhost:3000/" }, /not a public address/);
      await refused("upload_media_from_url", { url: "file:///etc/passwd" }, /./);
    });

    it("hands out a working upload grant and POST command", async () => {
      const result = await ok("get_media_upload_url", { fileName: "photo.png", altText: "A photo" });
      expect(result.curl).toContain("-X POST");
      expect(result.curl).toContain("-T ");
      const grant = readUploadGrant(new URL(result.uploadUrl).searchParams.get("token"));
      expect(grant).toMatchObject({ name: "photo.png", altText: "A photo" });
    });

    it("lists files without server paths, and sets alt text", async () => {
      const { media } = await ok("list_media", { limit: 100 });
      const item = media.find((m: any) => m.mediaId === imageId);
      expect(item.kind).toBe("image");
      expect(item.path).toBeUndefined();
      expect((await ok("update_media", { mediaId: imageId, altText: "New alt" })).altText).toBe("New alt");
      await refused("update_media", { mediaId: crypto.randomUUID(), altText: "x" }, /not found/);
    });

    it.each(["draft", "scheduled", "failed", "partial"])("won't delete a file a %s post uses", async (status) => {
      const postId = await draft({ parts: [{ text: "hi", mediaIds: [imageId] }] });
      await db.update(schema.posts).set({ status }).where(eq(schema.posts.postId, postId));
      await refused("delete_media", { mediaId: imageId }, /Used by/);
    });

    it("won't delete a file an idea uses, and deletes one nothing uses", async () => {
      const { ideaId } = await ok("create_idea", { title: "mcp-test", mediaIds: [imageId] });
      await refused("delete_media", { mediaId: imageId }, /Used by/);
      await ok("delete_idea", { ideaId });
      await ok("delete_media", { mediaId: imageId });
      expect((await ok("list_media", { limit: 100 })).media.map((m: any) => m.mediaId)).not.toContain(imageId);
    });

    it("won't delete a file only one account's text uses", async () => {
      await draft({ targets: [{ accountId: mastodon, parts: [{ text: "x", mediaIds: [imageId] }] }] });
      await refused("delete_media", { mediaId: imageId }, /Used by/);
    });
  });

  describe("snippets", () => {
    it("creates, lists, updates and deletes", async () => {
      const created = await ok("create_snippet", { kind: "template", name: "mcp-test-t", body: "Hello {{name}}" });
      expect((await ok("list_snippets", { kind: "template" })).map((s: any) => s.snippetId)).toContain(created.snippetId);
      expect((await ok("list_snippets", { kind: "hashtags" })).map((s: any) => s.snippetId)).not.toContain(created.snippetId);
      const updated = await ok("update_snippet", { snippetId: created.snippetId, body: "Hi" });
      expect(updated).toMatchObject({ name: "mcp-test-t", body: "Hi" });
      await refused("update_snippet", { snippetId: created.snippetId }, /Nothing to change/);
      await ok("delete_snippet", { snippetId: created.snippetId });
      await refused("delete_snippet", { snippetId: created.snippetId }, /not found/);
    });
  });

  describe("queue", () => {
    it("adds and removes slots, and rejects bad times", async () => {
      await refused("add_queue_slots", { days: [1], time: "25:00" }, /./);
      await refused("add_queue_slots", { days: [9], time: "09:00" }, /./);
      const [slot] = await ok("add_queue_slots", { days: [2, 2], time: "06:47" });
      const { queue } = await ok("list_accounts");
      expect(queue.slots.map((s: any) => s.queueSlotId)).toContain(slot.queueSlotId);
      expect(queue.nextFreeSlot).not.toBeNull();
      await ok("delete_queue_slot", { queueSlotId: slot.queueSlotId });
      await refused("delete_queue_slot", { queueSlotId: slot.queueSlotId }, /not found/);
    });
  });

  describe("ideas", () => {
    it("needs some content, and known ids", async () => {
      await refused("create_idea", {}, /title, some text or a file/);
      await refused("create_idea", { title: "mcp-test", mediaIds: [crypto.randomUUID()] }, /Unknown media/);
      await refused("create_idea", { title: "mcp-test", ideaGroupId: crypto.randomUUID() }, /Unknown idea group/);
      await refused("update_idea", { ideaId: crypto.randomUUID(), title: "x" }, /not found/);
    });

    it("filters by group and tags", async () => {
      const group = await ok("create_idea_group", { name: "mcp-test-column" });
      expect((await ok("create_idea_group", { name: "mcp-test-column" })).ideaGroupId).toBe(group.ideaGroupId);
      expect((await ok("list_idea_groups")).map((g: any) => g.name)).toContain("mcp-test-column");
      const tagged = (await ok("create_idea", { title: "mcp-test-a", tags: ["mcp-test-x"], ideaGroupId: group.ideaGroupId })).ideaId;
      const plain = (await ok("create_idea", { title: "mcp-test-b" })).ideaId;
      const ids = async (args: object) => (await ok("list_ideas", { limit: 100, ...args })).ideas.map((i: any) => i.ideaId);
      expect(await ids({ ideaGroupId: group.ideaGroupId })).toEqual([tagged]);
      expect(await ids({ ideaGroupId: null })).toContain(plain);
      expect(await ids({ tags: ["mcp-test-x"] })).toEqual([tagged]);
      const both = await ids({ tags: ["mcp-test-x"], includeUntagged: true });
      expect(both).toEqual(expect.arrayContaining([tagged, plain]));
    });

    it("updates only what you pass, and moves between columns", async () => {
      const group = await ok("create_idea_group", { name: "mcp-test-column" });
      const { ideaId } = await ok("create_idea", { title: "mcp-test", text: "body", tags: ["mcp-test-x"], mediaIds: [imageId] });
      await ok("update_idea", { ideaId, ideaGroupId: group.ideaGroupId });
      const [idea] = (await ok("list_ideas", { ideaGroupId: group.ideaGroupId })).ideas;
      expect(idea).toMatchObject({ title: "mcp-test", text: "body", tags: ["mcp-test-x"], mediaIds: [imageId] });
      expect(idea.media[0].url).toMatch(/\.png$/);
      await ok("delete_idea_group", { ideaGroupId: group.ideaGroupId });
      const unsorted = (await ok("list_ideas", { ideaGroupId: null, limit: 100 })).ideas;
      expect(unsorted.map((i: any) => i.ideaId)).toContain(ideaId);
    });

    it("turns into a post and leaves the board", async () => {
      const { ideaId } = await ok("create_idea", {
        title: "mcp-test",
        text: "mcp-test the idea's text",
        mediaIds: [imageId],
        tags: ["mcp-test-x"],
        networks: ["mastodon"],
      });
      const { postId, status } = await ok("create_post", { ideaId });
      expect(status).toBe("draft");
      const post = await ok("get_post", { postId });
      expect(post.parts[0]).toEqual({ text: "mcp-test the idea's text", mediaIds: [imageId] });
      expect(post.tags).toEqual(["mcp-test-x"]);
      expect(post.targets.map((t: any) => t.accountId)).toContain(mastodon);
      expect(post.targets.map((t: any) => t.accountId)).not.toContain(pinterest);
      await refused("delete_idea", { ideaId }, /not found/);
      await refused("create_post", { ideaId }, /Idea not found/);
    });

    it("stays on the board if the post can't be saved, and can be overridden", async () => {
      const { ideaId } = await ok("create_idea", { text: "mcp-test keep me" });
      await refused("create_post", { ideaId, targets: [{ accountId: mastodon }], scheduledAt: past() }, /in the past/);
      await refused("create_post", { ideaId, mode: "schedule", scheduledAt: future() }, /Choose at least one account/);
      expect((await ok("list_ideas", { limit: 100 })).ideas.map((i: any) => i.ideaId)).toContain(ideaId);
      const { postId } = await ok("create_post", { ideaId, parts: [{ text: "rewritten" }] });
      expect((await ok("get_post", { postId })).parts[0].text).toBe("rewritten");
    });

    it("keeps a title-only idea's content", async () => {
      const { ideaId } = await ok("create_idea", { title: "mcp-test only a title" });
      const { postId } = await ok("create_post", { ideaId });
      expect((await ok("get_post", { postId })).parts[0].text).toBe("mcp-test only a title");
    });
  });

  it("reports bad input and unknown tools as errors", async () => {
    await refused("get_post", { postId: "not-a-uuid" }, /./);
    expect((await call("no_such_tool")).isError).toBe(true);
  });
});
