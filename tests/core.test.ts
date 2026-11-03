import { beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt, hashPassword, sign, unsign, verifyPassword } from "@/lib/crypto";
import { MEDIA_NAME_RE, parseRange } from "@/lib/media";
import { findFacets } from "@/lib/networks/bluesky";
import { NETWORKS, validatePart } from "@/lib/networks/catalog";
import { nextFreeSlot } from "@/lib/queue";
import { applyStyle, countWithUrls, graphemes, threadsCount, toPlain } from "@/lib/text";

beforeAll(() => {
  process.env.APP_KEY = "test-key";
});

describe("unicode styles", () => {
  it("bolds letters and digits and round-trips", () => {
    const bold = applyStyle("Hi 42!", "bold");
    expect(bold).toBe("𝗛𝗶 𝟰𝟮!");
    expect(toPlain(bold)).toBe("Hi 42!");
  });
  it("restyles instead of stacking", () => {
    expect(applyStyle(applyStyle("abc", "bold"), "italic")).toBe(applyStyle("abc", "italic"));
  });
  it("leaves digits alone for italic (no italic digits exist)", () => {
    expect(applyStyle("a1", "italic")).toBe("𝘢1");
  });
});

describe("counters", () => {
  it("counts a family emoji as one grapheme", () => {
    expect(graphemes("👨‍👩‍👧 hi")).toBe(4);
  });
  it("weights URLs for Mastodon", () => {
    expect(countWithUrls("see https://example.com/a/very/long/path", 23)).toBe(4 + 23);
  });
  it("weights X URLs at 23 and emoji at 2", () => {
    expect(NETWORKS.x.count("https://example.com/" + "x".repeat(100))).toBe(23);
    expect(NETWORKS.x.count("😀")).toBe(2);
  });
  it("counts Threads emoji by UTF-8 bytes", () => {
    expect(threadsCount("a😀")).toBe(1 + 4);
  });
});

describe("queue", () => {
  const tz = "America/New_York";
  it("keeps wall-clock time across the DST change", () => {
    // DST starts Sun 2026-03-08. 09:00 EDT = 13:00Z (it would be 14:00Z in EST).
    const at = nextFreeSlot([{ dayOfWeek: 0, time: "09:00" }], [], tz, new Date("2026-03-07T12:00:00Z"));
    expect(at?.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });
  it("skips taken and past slots", () => {
    const now = new Date("2026-11-02T15:00:00Z"); // Mon 10:00 EST
    const slots = [
      { dayOfWeek: 1, time: "09:00" }, // already past today
      { dayOfWeek: 1, time: "12:00" },
      { dayOfWeek: 2, time: "09:00" },
    ];
    const taken = [new Date("2026-11-02T17:00:00Z")]; // Mon 12:00 EST
    expect(nextFreeSlot(slots, taken, tz, now)?.toISOString()).toBe("2026-11-03T14:00:00.000Z");
  });
  it("returns null without slots", () => {
    expect(nextFreeSlot([], [], tz)).toBeNull();
  });
});

describe("crypto", () => {
  it("encrypts and decrypts", () => {
    const enc = encrypt("secret-token");
    expect(enc).not.toContain("secret");
    expect(decrypt(enc)).toBe("secret-token");
  });
  it("rejects tampered and expired signed payloads", () => {
    const token = sign({ a: 1 }, 60);
    expect(unsign<{ a: number }>(token)?.a).toBe(1);
    expect(unsign(token.slice(0, -2) + "xx")).toBeNull();
    expect(unsign(sign({ a: 1 }, -1))).toBeNull();
  });
  it("hashes passwords", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("media", () => {
  it("only accepts generated names", () => {
    expect(MEDIA_NAME_RE.test("0b6a3c1e-1111-4222-8333-944455556666.jpg")).toBe(true);
    expect(MEDIA_NAME_RE.test("0b6a3c1e-1111-4222-8333-944455556666.ig.jpg")).toBe(true);
    expect(MEDIA_NAME_RE.test("../etc/passwd")).toBe(false);
    expect(MEDIA_NAME_RE.test("0b6a3c1e-1111-4222-8333-944455556666.html")).toBe(false);
  });
  it("parses Range headers", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=0-999", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=200-300", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
  });
});

describe("bluesky facets", () => {
  it("uses UTF-8 byte offsets", () => {
    const text = "😀 hi #café https://example.com @alice.bsky.social";
    const facets = findFacets(text);
    const bytes = new TextEncoder().encode(text);
    const slice = (f: { byteStart: number; byteEnd: number }) =>
      new TextDecoder().decode(bytes.slice(f.byteStart, f.byteEnd));
    expect(facets.map((f) => [f.kind, slice(f)])).toEqual([
      ["link", "https://example.com"],
      ["tag", "#café"],
      ["mention", "@alice.bsky.social"],
    ]);
    expect(facets.find((f) => f.kind === "tag")?.value).toBe("café");
  });
  it("drops trailing punctuation from links", () => {
    expect(findFacets("go to https://example.com/x.")[0].value).toBe("https://example.com/x");
  });
});

describe("validation", () => {
  const img = (w: number, h: number) => ({ kind: "image" as const, mime: "image/png", width: w, height: h });
  it("requires media on Instagram and checks aspect ratio", () => {
    expect(validatePart("instagram", { text: "hi", media: [] }, {})).toContain("Instagram: needs an image or video");
    expect(validatePart("instagram", { text: "hi", media: [img(1000, 2000)] }, { type: "feed" })).toContain(
      "Instagram: feed images must be between 4:5 and 1.91:1",
    );
    expect(validatePart("instagram", { text: "hi", media: [img(1080, 1350)] }, { type: "feed" })).toEqual([]);
  });
  it("enforces X limits", () => {
    expect(validatePart("x", { text: "a".repeat(281), media: [] }, {})[0]).toMatch(/281\/280/);
    expect(validatePart("x", { text: "a".repeat(281), media: [] }, {}, { subscriptionType: "Premium" })).toEqual([]);
  });
  it("requires a Pinterest board", () => {
    expect(validatePart("pinterest", { text: "", media: [img(100, 100)] }, {})).toContain("Pinterest: Board is required");
  });
});

describe("login throttle", () => {
  it("blocks after the free attempts and never evicts live lockouts", async () => {
    const { clearLoginFailures, loginBlockedFor, recordLoginFailure } = await import("@/lib/throttle");
    for (let i = 0; i < 6; i++) recordLoginFailure("victim", 5);
    expect(loginBlockedFor("victim")).toBeGreaterThan(0);
    // Flood with fresh keys: the table fills, but the live lockout stays.
    for (let i = 0; i < 10_050; i++) recordLoginFailure(`flood-${i}`, 5);
    expect(loginBlockedFor("victim")).toBeGreaterThan(0);
    // Full of recent entries: unknown keys fail closed.
    expect(loginBlockedFor("never-seen")).toBeGreaterThan(0);
    clearLoginFailures("victim");
    expect(loginBlockedFor("victim")).toBe(0);
  });
});
