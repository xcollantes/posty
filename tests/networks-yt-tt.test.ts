import { randomBytes } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/lib/media";
import { chunking, tiktok, tiktokPoll } from "@/lib/networks/tiktok";
import type { Account, PublishContext } from "@/lib/networks/types";
import { youtube } from "@/lib/networks/youtube";

const SIZE = 4096;
const file = path.join(os.tmpdir(), `posty-yt-tt-${process.pid}.mp4`);

type Call = { url: string; method: string; headers: Headers; body: unknown };
let calls: Call[] = [];
let routes: [RegExp, () => Response][] = [];

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json", ...init.headers } });

beforeAll(async () => {
  Object.assign(process.env, {
    APP_KEY: "k".repeat(64),
    YOUTUBE_CLIENT_ID: "yt-id",
    YOUTUBE_CLIENT_SECRET: "yt-secret",
    TIKTOK_CLIENT_ID: "tt-key",
    TIKTOK_CLIENT_SECRET: "tt-secret",
    PUBLIC_MEDIA_URL: "https://media.example",
    MEDIA_DIR: os.tmpdir(),
  });
  await writeFile(file, randomBytes(SIZE));
  tiktokPoll.intervalMs = 0;
});
afterAll(() => rm(file, { force: true }));

beforeEach(() => {
  calls = [];
  routes = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const u = String(input);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url: u, method: init.method ?? "GET", headers: new Headers(init.headers), body });
    const route = routes.find(([re]) => re.test(u));
    if (!route) throw new Error(`unexpected fetch ${u}`);
    return route[1]();
  });
});

const video: MediaItem = {
  mediaId: "m1",
  kind: "video",
  mime: "video/mp4",
  path: file,
  url: "https://media.example/media/m1.mp4",
  sizeBytes: SIZE,
  width: 1080,
  height: 1920,
  durationSeconds: 12,
  altText: "",
};
const acct = (username: string): Account => ({
  socialAccountId: "a1",
  providerAccountId: "p1",
  name: "Me",
  username,
  accessToken: "tok",
  refreshToken: "ref",
  expiresAt: null,
  tokenIssuedAt: new Date(),
  meta: {},
});
const ctx = (options: Record<string, string>): PublishContext => ({ idempotencyKey: "k", options, log: () => {} });
const part = { text: "Hello world\nmore text", media: [video] };

describe("youtube", () => {
  it("starts a resumable session then PUTs the bytes", async () => {
    const session = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc";
    routes = [
      [/upload_id=abc/, () => json({ id: "vid123" }, { status: 201 })],
      [/uploadType=resumable/, () => new Response(null, { status: 200, headers: { Location: session } })],
    ];
    const res = await youtube.publish(acct("me"), part, ctx({ privacy: "unlisted" }));
    expect(res).toEqual({ id: "vid123", url: "https://www.youtube.com/watch?v=vid123" });

    const [init, put] = calls;
    expect(init.method).toBe("POST");
    expect(init.headers.get("X-Upload-Content-Length")).toBe(String(SIZE));
    expect(init.body).toMatchObject({ snippet: { title: "Hello world" }, status: { privacyStatus: "unlisted" } });
    expect(put.method).toBe("PUT");
    expect(put.url).toBe(session);
    expect(put.headers.get("Content-Range")).toBe(`bytes 0-${SIZE - 1}/${SIZE}`);
    expect((put.body as Buffer).length).toBe(SIZE);
  });

  it("probes and resumes after a dropped connection", async () => {
    let puts = 0;
    routes = [
      [
        /upload_id=abc/,
        () => {
          puts++;
          if (puts === 1) throw new TypeError("socket hang up");
          if (puts === 2) return new Response(null, { status: 308, headers: { Range: "bytes=0-99" } });
          return json({ id: "vid9" });
        },
      ],
      [/uploadType=resumable/, () => new Response(null, { headers: { Location: "https://up.example/?upload_id=abc" } })],
    ];
    const res = await youtube.publish(acct("me"), part, ctx({ title: "T" })); // ~1s backoff
    expect(res.id).toBe("vid9");
    expect(calls[2].headers.get("Content-Range")).toBe(`bytes */${SIZE}`);
    expect(calls[3].headers.get("Content-Range")).toBe(`bytes 100-${SIZE - 1}/${SIZE}`);
  });
});

describe("tiktok", () => {
  const upload = "https://open-upload.tiktokapis.com/upload/?upload_id=u1";

  it("inbox mode: init, PUT, status fetch", async () => {
    routes = [
      [/inbox\/video\/init/, () => json({ data: { publish_id: "pub1", upload_url: upload }, error: { code: "ok" } })],
      [/upload_id=u1/, () => new Response(null, { status: 201 })],
      [/status\/fetch/, () => json({ data: { status: "SEND_TO_USER_INBOX" }, error: { code: "ok" } })],
    ];
    const res = await tiktok.publish(acct("me"), part, ctx({}));
    expect(res).toEqual({ id: "pub1", url: "https://www.tiktok.com/@me" });
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT", "POST"]);
    expect(calls[0].body).toEqual({
      source_info: { source: "FILE_UPLOAD", video_size: SIZE, chunk_size: SIZE, total_chunk_count: 1 },
    });
    expect(calls[1].headers.get("Content-Range")).toBe(`bytes 0-${SIZE - 1}/${SIZE}`);
    expect(calls[2].body).toEqual({ publish_id: "pub1" });
  });

  it("direct mode falls back to SELF_ONLY and keeps int64 post ids exact", async () => {
    routes = [
      [/creator_info/, () => json({ data: { privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } })],
      [/publish\/video\/init/, () => json({ data: { publish_id: "pub2", upload_url: upload }, error: { code: "ok" } })],
      [/upload_id=u1/, () => new Response(null, { status: 201 })],
      [
        /status\/fetch/,
        () =>
          new Response('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000123]},"error":{"code":"ok"}}'),
      ],
    ];
    const res = await tiktok.publish(acct("me"), part, ctx({ mode: "direct", privacy: "PUBLIC_TO_EVERYONE" }));
    const init = calls.find((c) => /publish\/video\/init/.test(c.url))!;
    expect((init.body as { post_info: { privacy_level: string } }).post_info.privacy_level).toBe("SELF_ONLY");
    expect(res).toEqual({ id: "7300000000000000123", url: "https://www.tiktok.com/@me/video/7300000000000000123" });
  });

  it("explains the unaudited-app error", async () => {
    routes = [
      [/creator_info/, () => json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } })],
      [
        /publish\/video\/init/,
        () => json({ data: {}, error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "x" } }, { status: 403 }),
      ],
    ];
    await expect(tiktok.publish(acct("me"), part, ctx({ mode: "direct" }))).rejects.toThrow(/inbox mode/);
  });

  it("sizes chunks: whole file under 10 MB, else 10 MB with the remainder merged", () => {
    const MB = 1024 * 1024;
    expect(chunking(3 * MB)).toEqual({ chunkSize: 3 * MB, count: 1 });
    expect(chunking(7 * MB)).toEqual({ chunkSize: 7 * MB, count: 1 });
    expect(chunking(25 * MB)).toEqual({ chunkSize: 10 * MB, count: 2 });
  });
});
