import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { inArray } from "drizzle-orm";
import sharp from "sharp";
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
  mime: string;
  originalName: string;
  // Reason: the browser already knows video dimensions/duration, so we
  // take them from the client instead of shipping ffprobe.
  videoMeta?: { width?: number; height?: number; durationSeconds?: number };
};

export async function saveUpload(input: UploadInput): Promise<Row> {
  const ext = MIME_EXT[input.mime];
  if (!ext) throw new Error(`Unsupported file type: ${input.mime}`);
  await mkdir(mediaDir(), { recursive: true });
  const mediaId = crypto.randomUUID();
  const fileName = `${mediaId}.${ext}`;
  const filePath = mediaPath(fileName);

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
      createWriteStream(filePath),
    );
  } catch (err) {
    await rm(filePath, { force: true });
    throw err;
  }

  let width = input.videoMeta?.width ?? null;
  let height = input.videoMeta?.height ?? null;
  if (input.mime.startsWith("image/")) {
    const meta = await sharp(filePath).metadata();
    width = meta.autoOrient?.width ?? meta.width ?? null;
    height = meta.autoOrient?.height ?? meta.height ?? null;
  }

  const [row] = await db
    .insert(schema.media)
    .values({
      mediaId,
      fileName,
      originalName: input.originalName.slice(0, 200),
      mime: input.mime,
      sizeBytes: size,
      width,
      height,
      durationSeconds: input.videoMeta?.durationSeconds
        ? Math.round(input.videoMeta.durationSeconds)
        : null,
    })
    .returning();
  return row;
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
