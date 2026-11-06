/**
 * The upload route against a real Postgres (compose.dev.yml) and a temporary
 * media folder. Skipped when DATABASE_URL isn't reachable.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_KEY ??= "test-key";
process.env.DATABASE_URL ??= "postgres://posty:posty@localhost:5432/posty";
const dir = await mkdtemp(path.join(os.tmpdir(), "posty-media-"));
process.env.MEDIA_DIR = dir;

// Stands in for the session cookie, which needs a real Next request.
let session: object | null = null;
vi.mock("@/lib/auth", () => ({ getUser: async () => session }));
let workspaceId = "";
vi.mock("@/lib/workspaces", () => ({ activeWorkspaceId: async () => workspaceId }));

const { db, schema } = await import("@/lib/db");
const { sign } = await import("@/lib/crypto");
const { createUploadGrant, sniffMime } = await import("@/lib/media");
const { POST } = await import("@/app/api/media/route");

const reachable = await db.execute(sql`select 1`).then(() => true, () => false);
const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#f00" } }).png().toBuffer();

const post = (body: BodyInit | null, query = "", headers: Record<string, string> = {}) =>
  POST(new Request(`http://localhost/api/media${query}`, { method: "POST", body, headers }));

describe.runIf(reachable)("POST /api/media", () => {
  beforeAll(async () => {
    [{ workspaceId }] = await db.select().from(schema.workspaces).limit(1);
  });

  beforeEach(() => {
    session = null;
  });

  afterAll(async () => {
    await db.execute(sql`delete from media where original_name like 'route-test%'`);
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a request with no session or grant", async () => {
    expect((await post(png)).status).toBe(401);
  });

  it("refuses tokens signed for something else, and expired grants", async () => {
    // The OAuth flow signs its state cookie with the same key.
    const oauthState = sign({ network: "x", state: "abc" }, 60);
    expect((await post(png, `?token=${oauthState}`)).status).toBe(401);
    const expired = sign({ purpose: "media-upload", name: "x", altText: "" }, -1);
    expect((await post(png, `?token=${expired}`)).status).toBe(401);
  });

  it("hides the route from Funnel traffic, even with a valid grant", async () => {
    const token = createUploadGrant(workspaceId, "route-test.png");
    const res = await post(png, `?token=${token}`, { "tailscale-funnel-request": "1" });
    expect(res.status).toBe(404);
  });

  it("takes the name and alt text from the grant", async () => {
    const token = createUploadGrant(workspaceId, "route-test-grant.png", "A red square");
    const res = await post(png, `?name=ignored.png&token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      originalName: "route-test-grant.png",
      altText: "A red square",
      mime: "image/png",
      width: 3,
      height: 2,
      sizeBytes: png.length,
    });
  });

  it("stores a mislabelled file under its real type", async () => {
    session = { userId: "someone" };
    const res = await post(png, "?name=route-test-mislabelled.jpg", { "Content-Type": "image/jpeg" });
    const row = await res.json();
    expect(row.mime).toBe("image/png");
    expect(row.fileName).toMatch(/\.png$/);
    expect(await readdir(dir)).toContain(row.fileName);
  });

  it.each([
    ["an empty file", ""],
    ["a web page", "<!doctype html><html></html>"],
  ])("rejects %s and leaves nothing behind", async (_label, body) => {
    session = { userId: "someone" };
    const before = await readdir(dir);
    const res = await post(body, "?name=route-test-bad");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unsupported file type/);
    expect(await readdir(dir)).toEqual(before);
  });

  it("rejects a corrupt image and leaves nothing behind", async () => {
    session = { userId: "someone" };
    const before = await readdir(dir);
    const res = await post(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(40)]), "?name=route-test-corrupt");
    expect(res.status).toBe(400);
    expect(await readdir(dir)).toEqual(before);
  });
});

describe("sniffMime", () => {
  const box = (type: string, brand: string) => Buffer.from(`\0\0\0\x18${type}${brand}`, "latin1");

  it.each([
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ["image/png", Buffer.from("\x89PNG\r\n\x1a\n", "latin1")],
    ["image/gif", Buffer.from("GIF89a")],
    ["image/webp", Buffer.from("RIFF\0\0\0\0WEBP", "latin1")],
    ["video/mp4", box("ftyp", "isom")],
    ["video/mp4", box("ftyp", "avc1")],
    ["video/quicktime", box("ftyp", "qt  ")],
    ["video/quicktime", box("moov", "")],
  ])("recognizes %s", (mime, head) => expect(sniffMime(head)).toBe(mime));

  it.each([
    ["HEIC", box("ftyp", "heic")],
    ["AVIF", box("ftyp", "avif")],
    ["M4A", box("ftyp", "M4A ")],
    ["HTML", Buffer.from("<!doctype html>")],
    ["RIFF that isn't WebP", Buffer.from("RIFF\0\0\0\0WAVE", "latin1")],
    ["nothing", Buffer.alloc(0)],
  ])("rejects %s", (_label, head) => expect(sniffMime(head)).toBeNull());
});
