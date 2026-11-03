import { getUser } from "@/lib/auth";
import { saveUpload } from "@/lib/media";

/**
 * Streaming upload: the raw file is the request body (no multipart), so
 * large videos never sit in memory and Server Action size limits don't apply.
 */
export async function POST(request: Request) {
  if (!(await getUser())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!request.body) return Response.json({ error: "Empty body" }, { status: 400 });

  const url = new URL(request.url);
  const num = (k: string) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : undefined);
  try {
    const row = await saveUpload({
      body: request.body,
      mime: (request.headers.get("content-type") ?? "").split(";")[0],
      originalName: url.searchParams.get("name") ?? "upload",
      videoMeta: { width: num("width"), height: num("height"), durationSeconds: num("duration") },
    });
    return Response.json(row);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
