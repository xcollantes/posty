import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Account, PublishContext } from "@/lib/networks/types";

beforeAll(() => {
  Object.assign(process.env, {
    APP_KEY: "test-key",
    X_CLIENT_ID: "xid",
    X_CLIENT_SECRET: "xsecret",
    LINKEDIN_CLIENT_ID: "lid",
    LINKEDIN_CLIENT_SECRET: "lsecret",
    PINTEREST_CLIENT_ID: "pid",
    PINTEREST_CLIENT_SECRET: "psecret",
    PUBLIC_MEDIA_URL: "https://media.example.com",
    MEDIA_DIR: "/tmp/posty-test-media",
  });
});

type Call = { url: string; init: RequestInit };

/** Stub fetch: first matching [pattern, responder] wins; records calls. */
function stubFetch(routes: [RegExp, () => Response][]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    calls.push({ url: input, init });
    const route = routes.find(([re]) => re.test(input));
    if (!route) throw new Error(`Unexpected fetch ${input}`);
    return route[1]();
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const acct = (over: Partial<Account> = {}): Account => ({
  socialAccountId: "sa1",
  providerAccountId: "123",
  name: "Me",
  username: "me",
  accessToken: "tok",
  refreshToken: "rt",
  expiresAt: null,
  tokenIssuedAt: new Date(),
  meta: {},
  ...over,
});

const ctx = (over: Partial<PublishContext> = {}): PublishContext => ({
  idempotencyKey: "k",
  options: {},
  log: () => {},
  ...over,
});

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

describe("escapeLittleText", () => {
  it("escapes reserved characters and keeps hashtags", async () => {
    const { escapeLittleText } = await import("@/lib/networks/linkedin");
    expect(escapeLittleText("Hello (world) my_name #launch")).toBe("Hello \\(world\\) my\\_name #launch");
    expect(escapeLittleText("#first # lone C# a\\b @me")).toBe("#first \\# lone C\\# a\\\\b \\@me");
  });
});

describe("x", () => {
  it("posts a reply to the parent part", async () => {
    const { x } = await import("@/lib/networks/x");
    const calls = stubFetch([[/\/2\/tweets$/, () => json({ data: { id: "999" } })]]);
    const parent = { id: "555", url: "https://x.com/me/status/555" };
    const res = await x.publish(acct(), { text: "part 2", media: [] }, ctx({ replyTo: { root: parent, parent } }));
    expect(res).toEqual({ id: "999", url: "https://x.com/me/status/999" });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ text: "part 2", reply: { in_reply_to_tweet_id: "555" } });
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer tok");
  });
});

describe("linkedin", () => {
  it("reads the post urn from x-restli-id", async () => {
    const { linkedin } = await import("@/lib/networks/linkedin");
    const urn = "urn:li:share:7000";
    const calls = stubFetch([[/\/rest\/posts$/, () => new Response(null, { status: 201, headers: { "x-restli-id": urn } })]]);
    const res = await linkedin.publish(acct({ providerAccountId: "abc" }), { text: "Hi (there)", media: [] }, ctx());
    expect(res).toEqual({ id: urn, url: `https://www.linkedin.com/feed/update/${urn}/` });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.author).toBe("urn:li:person:abc");
    expect(body.commentary).toBe("Hi \\(there\\)");
    expect(new Headers(calls[0].init.headers).get("LinkedIn-Version")).toBe("202610");
  });
});

describe("pinterest", () => {
  it("requires a board", async () => {
    const { pinterest } = await import("@/lib/networks/pinterest");
    const calls = stubFetch([]);
    await expect(pinterest.publish(acct(), { text: "pin", media: [] }, ctx())).rejects.toThrow("Choose a Pinterest board");
    expect(calls).toHaveLength(0);
  });
});
