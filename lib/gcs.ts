import path from "node:path";
import { Storage } from "@google-cloud/storage";
import type { MediaItem } from "@/lib/media";

// Reason: Meta fetches the file while creating the container, within minutes.
const SIGNED_URL_TTL_MS = 60 * 60 * 1000;

let storage: Storage | undefined;

/**
 * A URL Meta (Instagram, Threads, Facebook video) can fetch the file from.
 * With GCS_BUCKET set, the file is copied to that private bucket and a
 * short-lived signed URL is returned, so nothing on the host is public.
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS. Without GCS_BUCKET
 * it falls back to the PUBLIC_MEDIA_URL link.
 */
export async function fetchUrl(item: MediaItem): Promise<string> {
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) return item.url;
  const bucket = (storage ??= new Storage()).bucket(bucketName);
  const name = path.basename(item.path);
  await bucket.upload(item.path, { destination: name, metadata: { contentType: item.mime } });
  const [url] = await bucket.file(name).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + SIGNED_URL_TTL_MS,
  });
  return url;
}
