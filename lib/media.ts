import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { sign, unsign } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { mediaDir, publicMediaBase } from "@/lib/env";

export const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};
export const EXT_MIME = Object.fromEntries(
  Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]),
);
EXT_MIME.jpeg = "image/jpeg";

/** Only names we generate: <uuid>[.ig].<ext>. Anything else is refused. */
export const MEDIA_NAME_RE = /^[0-9a-f-]{36}(\.ig)?\.(jpg|jpeg|png|webp|gif|mp4|mov)$/;

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB
export const MAX_ALT_TEXT = 1500;

export type MediaItem = {
  mediaId: string;
  kind: "image" | "video";
  mime: string;
  path: string;
  url: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  altText: string;
};

export const mediaPath = (fileName: string) => path.resolve(mediaDir(), fileName);
export const publicMediaUrl = (fileName: string) => `${publicMediaBase()}/media/${fileName}`;

type Row = typeof schema.media.$inferSelect;

export function toItem(row: Row): MediaItem {
  return {
    mediaId: row.mediaId,
    kind: row.mime.startsWith("video/") ? "video" : "image",
    mime: row.mime,
    path: mediaPath(row.fileName),
    url: publicMediaUrl(row.fileName),
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    altText: row.altText,
  };
}

/** Load media rows by id, keeping the order of `ids`. */
export async function loadMedia(ids: string[]): Promise<MediaItem[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(schema.media).where(inArray(schema.media.mediaId, ids));
  const byId = new Map(rows.map((r) => [r.mediaId, r]));
  return ids.flatMap((id) => (byId.has(id) ? [toItem(byId.get(id)!)] : []));
}

type UploadInput = {
  body: ReadableStream<Uint8Array>;
  originalName: string;
  altText?: string;
  // Reason: the browser already knows video dimensions/duration, so we
  // take them from the client instead of shipping ffprobe.
  videoMeta?: { width?: number; height?: number; durationSeconds?: number };
};

/**
 * What a file really is, from its first 12 bytes. Browsers label files by
 * extension and remote servers can say anything, so neither label is used.
 */
export function sniffMime(head: Buffer): string | null {
  const text = (from: number, to: number) => head.toString("latin1", from, to);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (text(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (text(0, 4) === "GIF8") return "image/gif";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
  const box = text(4, 8);
  if (box === "ftyp") {
    const brand = text(8, 12);
    // Reason: HEIC, AVIF and M4A share MP4's container but no network takes them as video.
    if (/^(hei|hev|mif|msf|avi|M4A|M4B|M4P)/.test(brand)) return null;
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  // Older QuickTime files start straight in with one of these boxes.
  return ["moov", "mdat", "wide", "free", "skip"].includes(box) ? "video/quicktime" : null;
}

async function readHead(filePath: string): Promise<Buffer> {
  const file = await open(filePath);
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(12), 0, 12, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

export async function saveUpload(input: UploadInput): Promise<Row> {
  await mkdir(mediaDir(), { recursive: true });
  const mediaId = crypto.randomUUID();
  // Reason: the real extension isn't known until the bytes are in. MEDIA_NAME_RE
  // refuses .part, so a half-written file can't be served.
  const partPath = mediaPath(`${mediaId}.part`);
  let savedPath: string | null = null;

  let size = 0;
  const limit = new Transform({
    transform(chunk, _enc, done) {
      size += chunk.length;
      done(size > MAX_UPLOAD_BYTES ? new Error("File is larger than 1 GB") : null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(input.body as import("node:stream/web").ReadableStream),
      limit,
      createWriteStream(partPath),
    );

    const mime = sniffMime(await readHead(partPath));
    if (!mime) throw new Error("Unsupported file type: use JPEG, PNG, WebP, GIF, MP4 or MOV");

    let width = input.videoMeta?.width ?? null;
    let height = input.videoMeta?.height ?? null;
    if (mime.startsWith("image/")) {
      const meta = await sharp(partPath).metadata();
      width = meta.autoOrient?.width ?? meta.width ?? null;
      height = meta.autoOrient?.height ?? meta.height ?? null;
    }

    const fileName = `${mediaId}.${MIME_EXT[mime]}`;
    savedPath = mediaPath(fileName);
    await rename(partPath, savedPath);

    const [row] = await db
      .insert(schema.media)
      .values({
        mediaId,
        fileName,
        originalName: input.originalName.slice(0, 200),
        mime,
        sizeBytes: size,
        width,
        height,
        durationSeconds: input.videoMeta?.durationSeconds
          ? Math.round(input.videoMeta.durationSeconds)
          : null,
        altText: (input.altText ?? "").slice(0, MAX_ALT_TEXT),
      })
      .returning();
    return row;
  } catch (err) {
    await rm(partPath, { force: true });
    if (savedPath) await rm(savedPath, { force: true });
    throw err;
  }
}

const UPLOAD_PURPOSE = "media-upload";
export const UPLOAD_GRANT_SECONDS = 15 * 60;

/**
 * Lets the holder POST one file's bytes to /api/media without a session, for
 * clients that can run curl but have no cookie.
 * ponytail: reusable until it expires; store used grants if that ever matters.
 */
export const createUploadGrant = (name: string, altText = "") =>
  sign({ purpose: UPLOAD_PURPOSE, name, altText }, UPLOAD_GRANT_SECONDS);

/** The grant in `token`, or null. `purpose` keeps out tokens signed for anything else. */
export function readUploadGrant(token: string | null): { name: string; altText: string } | null {
  const grant = unsign<{ purpose?: string; name: string; altText: string }>(token ?? undefined);
  return grant?.purpose === UPLOAD_PURPOSE ? grant : null;
}

/**
 * Delete a file unless a post that can still go out needs it. Failed and
 * partial posts count: Retry would otherwise publish them without it.
 */
export async function deleteMediaIfUnused(mediaId: string): Promise<{ error?: string }> {
  const [used] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from posts
    where status in ('draft', 'scheduled', 'failed', 'partial') and (content::text like ${"%" + mediaId + "%"}
      or exists (select 1 from post_targets t where t.post_id = posts.post_id and t.content_override::text like ${"%" + mediaId + "%"}))`);
  if (used.n > 0) return { error: "Used by a post that hasn't fully gone out" };
  const [row] = await db.delete(schema.media).where(eq(schema.media.mediaId, mediaId)).returning();
  if (row) await deleteMediaFiles(row.fileName);
  return {};
}

export async function deleteMediaFiles(fileName: string) {
  const base = fileName.replace(/\.[a-z0-9]+$/, "");
  await rm(mediaPath(fileName), { force: true });
  await rm(mediaPath(`${base}.ig.jpg`), { force: true });
}

/**
 * Instagram only accepts JPEG. Returns the item unchanged when it already
 * is one, otherwise a cached <uuid>.ig.jpg sibling.
 */
export async function asJpeg(item: MediaItem): Promise<MediaItem> {
  if (item.kind !== "image" || item.mime === "image/jpeg") return item;
  const fileName = `${item.mediaId}.ig.jpg`;
  const out = mediaPath(fileName);
  const exists = await stat(out).then(() => true, () => false);
  if (!exists) {
    await sharp(item.path).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toFile(out);
  }
  const { size } = await stat(out);
  return { ...item, mime: "image/jpeg", path: out, url: publicMediaUrl(fileName), sizeBytes: size };
}

/** Parse a single-range `Range: bytes=a-b` header. Null means "serve whole file". */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    // suffix range: last N bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? "invalid" : { start, end };
}
