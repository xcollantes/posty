/**
 * One-time sign-in links against a real Postgres (compose.dev.yml). Skipped
 * when DATABASE_URL isn't reachable.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.APP_KEY ??= "test-key";
process.env.DATABASE_URL ??= "postgres://posty:posty@localhost:5432/posty";
process.env.APP_URL = "https://posty.example.ts.net";

const { db, schema } = await import("@/lib/db");
const { consumeSignInLink, findSignInLink, issueSignInLink, rp } = await import("@/lib/passkeys");

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
