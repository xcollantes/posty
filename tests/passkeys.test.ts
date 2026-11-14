/**
 * One-time sign-in links against a real Postgres (compose.dev.yml). Skipped
 * when DATABASE_URL isn't reachable.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_KEY ??= "test-key";
process.env.DATABASE_URL ??= "postgres://posty:posty@localhost:5432/posty";
process.env.APP_URL = "https://posty.example.ts.net";

let sessionToken: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (sessionToken ? { value: sessionToken } : undefined) }),
}));

const { db, schema } = await import("@/lib/db");
const { consumeSignInLink, findSignInLink, issueSignInLink, rp } = await import("@/lib/passkeys");
const { randomToken, sha256 } = await import("@/lib/crypto");

const reachable = await db.execute(sql`select 1`).then(() => true, () => false);
const tokenOf = (url: string) => url.split("/login/link/")[1];

describe("relying party", () => {
  it("binds passkeys to APP_URL's hostname and origin", () => {
    expect(rp()).toMatchObject({ rpID: "posty.example.ts.net", origin: "https://posty.example.ts.net" });
  });
});

describe.runIf(reachable)("sign-in links", () => {
  let userId = "";

  beforeAll(async () => {
    [{ userId }] = await db
      .insert(schema.users)
      .values({ email: `passkeys-test-${crypto.randomUUID()}@example.test`, name: "Test" })
      .returning();
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.userId, userId));
  });

  it("can be read any number of times but used only once", async () => {
    const token = tokenOf(await issueSignInLink(userId));
    expect((await findSignInLink(token))?.userId).toBe(userId);
    expect((await findSignInLink(token))?.userId).toBe(userId);
    expect(await consumeSignInLink(token)).toBe(userId);
    expect(await consumeSignInLink(token)).toBeNull();
    expect(await findSignInLink(token)).toBeNull();
  });

  it("dies when a newer link is issued", async () => {
    const old = tokenOf(await issueSignInLink(userId));
    const fresh = tokenOf(await issueSignInLink(userId));
    expect(await consumeSignInLink(old)).toBeNull();
    expect(await consumeSignInLink(fresh)).toBe(userId);
  });

  it("dies when it expires", async () => {
    const token = tokenOf(await issueSignInLink(userId));
    await db
      .update(schema.signInLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.signInLinks.userId, userId));
    expect(await findSignInLink(token)).toBeNull();
    expect(await consumeSignInLink(token)).toBeNull();
  });

  it("rejects made-up tokens", async () => {
    expect(await consumeSignInLink("not-a-real-token")).toBeNull();
  });
});

describe.runIf(reachable)("issuing links in Settings", () => {
  const ids: string[] = [];
  const makeUser = async () => {
    const [{ userId }] = await db
      .insert(schema.users)
      .values({ email: `passkeys-test-${crypto.randomUUID()}@example.test`, name: "Test" })
      .returning();
    ids.push(userId);
    return userId;
  };
  const addPasskey = (userId: string) =>
    db.insert(schema.passkeys).values({ passkeyId: crypto.randomUUID(), userId, publicKey: "x" });

  beforeAll(async () => {
    // Sign in as a user who has a passkey.
    const me = await makeUser();
    await addPasskey(me);
    sessionToken = randomToken();
    await db.insert(schema.sessions).values({
      sessionId: sha256(sessionToken),
      userId: me,
      expiresAt: new Date(Date.now() + 60_000),
    });
  });

  afterAll(async () => {
    sessionToken = undefined;
    await db.delete(schema.users).where(inArray(schema.users.userId, ids));
  });

  it("are only for users without a passkey, so no user can take over another's account", async () => {
    const { newSignInLink } = await import("@/app/actions/library");
    const fresh = await makeUser();
    expect((await newSignInLink(fresh))?.ok).toContain("/login/link/");

    const enrolled = await makeUser();
    await addPasskey(enrolled);
    expect((await newSignInLink(enrolled))?.error).toMatch(/already have a passkey/);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.signInLinks)
      .where(eq(schema.signInLinks.userId, enrolled));
    expect(n).toBe(0);
  });
});
