import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/lib/media";
import { facebook } from "@/lib/networks/facebook";
import { instagram } from "@/lib/networks/instagram";
import { threads } from "@/lib/networks/threads";
import type { Account, PublishContext } from "@/lib/networks/types";

Object.assign(process.env, {
  APP_KEY: "test-key-test-key-test-key-test-key",
  FACEBOOK_CLIENT_ID: "fb", FACEBOOK_CLIENT_SECRET: "fbs",
  INSTAGRAM_CLIENT_ID: "ig", INSTAGRAM_CLIENT_SECRET: "igs",
  THREADS_CLIENT_ID: "th", THREADS_CLIENT_SECRET: "ths",
  PUBLIC_MEDIA_URL: "https://media.example.com",
  MEDIA_DIR: "/tmp/posty-test-media",
});

type Call = { method: string; url: string; body: Record<string, string>; auth: string | null };
let calls: Call[] = [];
let routes: [RegExp, unknown, number?][] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    calls.push({ method, url: input, body, auth: new Headers(init.headers).get("Authorization") });
    const hit = routes.find(([re]) => re.test(`${method} ${input}`));
    if (!hit) return new Response(`no route for ${method} ${input}`, { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: hit[2] ?? 200 });
  });
});

const acct = (id: string): Account => ({
  socialAccountId: "sa1", providerAccountId: id, name: "Me", username: "me",
  accessToken: "TOKEN", refreshToken: null, expiresAt: null, tokenIssuedAt: new Date(),
  meta: {},
});
const ctx = (extra: Partial<PublishContext> = {}): PublishContext => ({
  idempotencyKey: "k", options: {}, log: () => {}, ...extra,
});
const seq = () => calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);

describe("instagram", () => {
  it("publishes a single image: container → poll → media_publish → permalink", async () => {
    routes = [
      [/POST .*\/v26\.0\/ig1\/media_publish$/, { id: "m1" }],
      [/POST .*\/v26\.0\/ig1\/media$/, { id: "c1" }],
      [/GET .*\/v26\.0\/c1\?/, { status_code: "FINISHED" }],
      [/GET .*\/v26\.0\/m1\?fields=permalink/, { permalink: "https://www.instagram.com/p/abc/" }],
    ];
    const img: MediaItem = {
      mediaId: "x", kind: "image", mime: "image/jpeg", path: "/tmp/x.jpg",
      url: "https://media.example.com/media/x.jpg", sizeBytes: 1, width: 1080, height: 1080,
      durationSeconds: null, altText: "a cat",
    };
    const res = await instagram.publish(acct("ig1"), { text: "hi", media: [img] }, ctx());
    expect(seq()).toEqual(["POST /v26.0/ig1/media", "GET /v26.0/c1", "POST /v26.0/ig1/media_publish", "GET /v26.0/m1"]);
    expect(calls[0].body).toMatchObject({ image_url: img.url, caption: "hi", alt_text: "a cat", access_token: "TOKEN" });
    expect(calls[2].body).toMatchObject({ creation_id: "c1" });
    expect(res).toEqual({ id: "m1", url: "https://www.instagram.com/p/abc/" });
  });
});

describe("facebook", () => {
  it("publishes a text post to /feed", async () => {
    routes = [[/POST https:\/\/graph\.facebook\.com\/v26\.0\/p1\/feed$/, { id: "p1_99" }]];
    const res = await facebook.publish(acct("p1"), { text: "hello", media: [] }, ctx());
    expect(seq()).toEqual(["POST /v26.0/p1/feed"]);
    expect(calls[0].body).toEqual({ message: "hello" });
    expect(calls[0].auth).toBe("Bearer TOKEN");
    expect(res).toEqual({ id: "p1_99", url: "https://www.facebook.com/p1_99" });
  });

  it("turns a code-190 error into reconnect", async () => {
    routes = [[/feed$/, { error: { message: "Session expired", code: 190 } }, 400]];
    await expect(facebook.publish(acct("p1"), { text: "x", media: [] }, ctx())).rejects.toMatchObject({
      reconnect: true,
      retryable: false,
    });
  });
});

describe("threads", () => {
  it("publishes text, then a reply with reply_to_id", async () => {
    routes = [
      [/POST .*\/v1\.0\/u1\/threads_publish$/, { id: "post1" }],
      [/POST .*\/v1\.0\/u1\/threads$/, { id: "t1" }],
      [/GET .*\/v1\.0\/t1\?/, { status: "FINISHED" }],
      [/GET .*\/v1\.0\/post1\?fields=permalink/, { permalink: "https://www.threads.com/@me/post/abc" }],
    ];
    const a = acct("u1");
    const root = await threads.publish(a, { text: "one", media: [] }, ctx());
    expect(root).toEqual({ id: "post1", url: "https://www.threads.com/@me/post/abc" });
    expect(calls[0].body).toMatchObject({ media_type: "TEXT", text: "one" });
    expect(calls[0].body.reply_to_id).toBeUndefined();

    calls = [];
    await threads.publish(a, { text: "two", media: [] }, ctx({ replyTo: { root, parent: root } }));
    expect(seq()).toEqual(["POST /v1.0/u1/threads", "GET /v1.0/t1", "POST /v1.0/u1/threads_publish", "GET /v1.0/post1"]);
    expect(calls[0].body).toMatchObject({ media_type: "TEXT", text: "two", reply_to_id: "post1" });
    expect(calls[2].body).toMatchObject({ creation_id: "t1" });
  });
});
