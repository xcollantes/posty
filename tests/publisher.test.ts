/**
 * Worker integration tests against a real Postgres (compose.dev.yml).
 * Skipped when DATABASE_URL isn't reachable.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_KEY ??= "test-key";
process.env.DATABASE_URL ??= "postgres://posty:posty@localhost:5432/posty";

// A fake thread-capable network whose behaviour each test scripts.
const calls: { text: string; replyTo?: string }[] = [];
let script: ((text: string) => void) | null = null;
vi.mock("@/lib/networks", async () => {
  const { NETWORKS } = await import("@/lib/networks/catalog");
  const fake = {
    id: "mastodon",
    info: NETWORKS.mastodon,
    connect: { kind: "form", fields: [], verify: async () => [] },
    async publish(_acct: unknown, part: { text: string }, ctx: { replyTo?: { parent: { id: string } } }) {
      calls.push({ text: part.text, replyTo: ctx.replyTo?.parent.id });
      script?.(part.text);
      return { id: `id-${calls.length}`, url: `https://example.social/${calls.length}` };
    },
  };
  return { networks: { mastodon: fake }, getNetwork: () => fake };
});

const { db, schema } = await import("@/lib/db");
const { encrypt } = await import("@/lib/crypto");
const { NetworkError } = await import("@/lib/networks/http");
const { claimDue, failMissed, failStuck, publishTarget } = await import("@/lib/publisher");

const reachable = await db.execute(sql`select 1`).then(() => true, () => false);

let accountId = "";
let workspaceId = "";

async function makePost(texts: string[], accounts = 1) {
  const [post] = await db
    .insert(schema.posts)
    .values({
      workspaceId,
      status: "scheduled",
      scheduledAt: new Date(Date.now() - 1000),
      content: { parts: texts.map((text) => ({ text, mediaIds: [] })) },
    })
    .returning();
  const ids: string[] = [];
  for (let i = 0; i < accounts; i++) {
    const acct =
      i === 0
        ? accountId
        : (
            await db
              .insert(schema.socialAccounts)
              .values({ workspaceId, network: "mastodon", providerAccountId: `extra-${crypto.randomUUID()}`, name: "Extra", accessTokenEnc: encrypt("t") })
              .returning()
          )[0].socialAccountId;
    const [t] = await db.insert(schema.postTargets).values({ postId: post.postId, socialAccountId: acct }).returning();
    ids.push(t.postTargetId);
  }
  return { postId: post.postId, targetIds: ids };
}

const target = async (id: string) =>
  (await db.select().from(schema.postTargets).where(eq(schema.postTargets.postTargetId, id)))[0];
const post = async (id: string) => (await db.select().from(schema.posts).where(eq(schema.posts.postId, id)))[0];

describe.skipIf(!reachable)("publisher", () => {
  beforeAll(async () => {
    [{ workspaceId }] = await db.select().from(schema.workspaces).limit(1);
    const [a] = await db
      .insert(schema.socialAccounts)
      .values({ workspaceId, network: "mastodon", providerAccountId: `test-${crypto.randomUUID()}`, name: "Test", accessTokenEnc: encrypt("token") })
      .returning();
    accountId = a.socialAccountId;
  });

  beforeEach(async () => {
    calls.length = 0;
    script = null;
    // Isolate: nothing else should be due while a test runs.
    await db.update(schema.posts).set({ status: "draft" }).where(eq(schema.posts.status, "scheduled"));
  });

  afterAll(async () => {
    await db.delete(schema.socialAccounts).where(sql`provider_account_id like 'test-%' or provider_account_id like 'extra-%'`);
  });

  it("claims due targets once (SKIP LOCKED) and publishes a thread", async () => {
    const { postId, targetIds } = await makePost(["one", "two"]);
    const claimed = await claimDue(10);
    expect(claimed).toEqual(targetIds);
    expect(await claimDue(10)).toEqual([]);

    await publishTarget(targetIds[0]);
    expect(calls).toEqual([{ text: "one" }, { text: "two", replyTo: "id-1" }]);
    const t = await target(targetIds[0]);
    expect(t.status).toBe("published");
    expect(t.url).toBe("https://example.social/1");
    expect((await post(postId)).status).toBe("published");
  });

  it("retries a retryable error when nothing went live", async () => {
    const { postId, targetIds } = await makePost(["hello"]);
    script = () => {
      throw new NetworkError("503", 503, true);
    };
    await claimDue(10);
    await publishTarget(targetIds[0]);
    const t = await target(targetIds[0]);
    expect(t.status).toBe("pending");
    expect(t.attemptCount).toBe(1);
    expect(t.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await post(postId)).status).toBe("scheduled");
    // Not due yet, so not claimable.
    expect(await claimDue(10)).toEqual([]);
  });

  it("never retries a thread that partly went live", async () => {
    const { targetIds } = await makePost(["one", "two"]);
    script = (text) => {
      if (text === "two") throw new NetworkError("503", 503, true);
    };
    await claimDue(10);
    await publishTarget(targetIds[0]);
    const t = await target(targetIds[0]);
    expect(t.status).toBe("failed");
    expect(t.providerPostId).toBe("id-1");
    expect(t.error).toMatch(/Partly published/);
  });

  it("rolls up to partial and flags reconnect on auth errors", async () => {
    const { postId, targetIds } = await makePost(["hi"], 2);
    await claimDue(10);
    await publishTarget(targetIds[0]);
    script = () => {
      throw new NetworkError("401", 401, false, true);
    };
    await publishTarget(targetIds[1]);
    expect((await target(targetIds[1])).status).toBe("failed");
    expect((await post(postId)).status).toBe("partial");
    const [extra] = await db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.socialAccountId, (await target(targetIds[1])).socialAccountId));
    expect(extra.needsReconnect).toBe(true);
  });

  it("fails targets stuck in publishing instead of re-posting", async () => {
    const { postId, targetIds } = await makePost(["stuck"]);
    await db
      .update(schema.postTargets)
      .set({ status: "publishing", lockedAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(schema.postTargets.postTargetId, targetIds[0]));
    await failStuck();
    expect((await target(targetIds[0])).status).toBe("failed");
    expect((await post(postId)).status).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("fails posts overdue past the cutoff instead of publishing late", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const stale = await makePost(["stale"]);
    const fresh = await makePost(["fresh"]);
    // Saved just now with a past time: the user re-scheduled it, so it posts.
    const resaved = await makePost(["resaved"]);
    await db
      .update(schema.posts)
      .set({ scheduledAt: twoHoursAgo, updatedAt: twoHoursAgo })
      .where(eq(schema.posts.postId, stale.postId));
    await db.update(schema.posts).set({ scheduledAt: twoHoursAgo }).where(eq(schema.posts.postId, resaved.postId));
    await failMissed();
    expect((await target(stale.targetIds[0])).status).toBe("failed");
    expect((await post(stale.postId)).status).toBe("failed");
    expect((await target(fresh.targetIds[0])).status).toBe("pending");
    expect((await target(resaved.targetIds[0])).status).toBe("pending");
    expect((await claimDue(10)).sort()).toEqual([...fresh.targetIds, ...resaved.targetIds].sort());
  });
});
