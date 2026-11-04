/** Read a required environment variable, failing fast when it is missing. */
export function env(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/** Public base URL of the UI, e.g. https://posty.tailnet.ts.net */
export const appUrl = () => env("APP_URL", "http://localhost:3000").replace(/\/$/, "");

/** Base URL for /media/ links, used when GCS_BUCKET is unset */
export const publicMediaBase = () =>
  env("PUBLIC_MEDIA_URL", appUrl()).replace(/\/$/, "");

export const mediaDir = () => env("MEDIA_DIR", "./data/media");
