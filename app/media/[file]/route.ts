import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { EXT_MIME, MEDIA_NAME_RE, mediaPath, parseRange } from "@/lib/media";

/**
 * Media endpoint for UI previews (and the no-GCS fallback URL handed to
 * Meta). Names are random UUIDs; no listing, no traversal.
 */
export async function GET(request: Request, ctx: RouteContext<"/media/[file]">) {
  const { file } = await ctx.params;
  if (!MEDIA_NAME_RE.test(file)) return new Response("Not found", { status: 404 });

  const filePath = mediaPath(file);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return new Response("Not found", { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": EXT_MIME[file.split(".").pop()!] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };

  const range = parseRange(request.headers.get("range"), info.size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
  }
  const { start, end } = range ?? { start: 0, end: info.size - 1 };
  const body =
    request.method === "HEAD"
      ? null
      : (Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream);

  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}),
    },
  });
}

export { GET as HEAD };
