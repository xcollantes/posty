/**
 * Error from a network API.
 * - retryable: the request was refused before anything was created
 *   (429 / 5xx on a non-final call), so trying again can't double-post.
 * - reconnect: the token is dead; the account needs a new login.
 */
export class NetworkError extends Error {
  constructor(
    message: string,
    public status: number | null = null,
    public retryable = false,
    public reconnect = false,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

export type FetchOptions = RequestInit & {
  /** JSON body; sets Content-Type. */
  json?: unknown;
  /** Form body (application/x-www-form-urlencoded). */
  form?: Record<string, string | undefined>;
  bearer?: string;
  /**
   * The call that creates the visible post. A 5xx here might still have
   * created it, so it's never retried automatically (429 still is).
   */
  final?: boolean;
  timeoutMs?: number;
};

function buildInit(opts: FetchOptions): RequestInit {
  const { json, form, bearer, final: _final, timeoutMs = 60_000, headers, ...init } = opts;
  const h = new Headers(headers);
  if (bearer) h.set("Authorization", `Bearer ${bearer}`);
  let body = init.body;
  if (json !== undefined) {
    h.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  } else if (form) {
    h.set("Content-Type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(
      Object.entries(form).filter((e): e is [string, string] => e[1] !== undefined),
    ).toString();
  }
  return { ...init, headers: h, body, signal: init.signal ?? AbortSignal.timeout(timeoutMs) };
}

/** fetch() that throws NetworkError with the provider's error body. */
export async function request(url: string, opts: FetchOptions = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, buildInit(opts));
  } catch (err) {
    // Timeouts/connection resets are ambiguous: the post may exist.
    throw new NetworkError(`Request to ${new URL(url).host} failed: ${(err as Error).message}`);
  }
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  const status = res.status;
  const retryable = status === 429 || (status >= 500 && !opts.final);
  const reconnect = status === 401;
  throw new NetworkError(
    `${new URL(url).host} ${status}: ${text.slice(0, 500) || res.statusText}`,
    status,
    retryable,
    reconnect,
  );
}

export async function fetchJson<T = Record<string, unknown>>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await request(url, opts);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Poll `check` until it returns a value (non-undefined), or time out. */
export async function pollUntil<T>(
  check: () => Promise<T | undefined>,
  { intervalMs = 5_000, timeoutMs = 10 * 60_000, what = "processing", retryable = false } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await sleep(intervalMs);
  }
  throw new NetworkError(`Timed out waiting for ${what}`, null, retryable);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Build a URL with query params, skipping undefined values. */
export function url(base: string, params: Record<string, string | number | undefined>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
}

export const basicAuth = (id: string, secret: string) =>
  `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

export const secondsFromNow = (s: number | undefined | null) =>
  s ? new Date(Date.now() + Number(s) * 1000) : null;

/** OAuth client credentials from env, e.g. creds("FACEBOOK") → FACEBOOK_CLIENT_ID/SECRET. */
export function creds(prefix: string): { clientId: string; clientSecret: string } {
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    throw new NetworkError(`Set ${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET in .env (see docs/networks.md)`);
  }
  return { clientId, clientSecret };
}
