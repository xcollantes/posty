import { getUser } from "@/lib/auth";
import { readUploadGrant, saveUpload } from "@/lib/media";

/**
 * Streaming upload: the raw file is the request body (no multipart), so
 * large videos never sit in memory and Server Action size limits don't apply.
 * Callers have a session, or a signed `token` from the MCP tool
 * get_media_upload_url. The file's type comes from its content.
 */
export async function POST(request: Request) {
  // Reason: proxy.ts skips this route so bodies stream; its Funnel rule still applies.
  if (request.headers.get("tailscale-funnel-request")) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const grant = readUploadGrant(url.searchParams.get("token"));
  if (!grant && !(await getUser())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!request.body) return Response.json({ error: "Empty body" }, { status: 400 });

  const num = (k: string) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : undefined);
  try {
    const row = await saveUpload({
      body: request.body,
      originalName: grant?.name ?? url.searchParams.get("name") ?? "upload",
      altText: grant?.altText,
      videoMeta: { width: num("width"), height: num("height"), durationSeconds: num("duration") },
    });
    return Response.json(row);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
