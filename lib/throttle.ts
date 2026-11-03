/** Failed-login throttle. Pure in-memory, so it is unit-testable. */

// ponytail: in-memory failed-login throttle; fine for one container behind a tailnet.
const failures = new Map<string, { count: number; until: number }>();

const MAX_ENTRIES = 10_000;
const STALE_MS = 15 * 60_000;

export function loginBlockedFor(key: string): number {
  const entry = failures.get(key);
  if (!entry) {
    // Fail closed: if the table is full of recent failures, refuse new keys
    // rather than evicting active lockouts.
    return failures.size >= MAX_ENTRIES && (prune(), failures.size >= MAX_ENTRIES) ? 60 : 0;
  }
  return entry.until > Date.now() ? Math.ceil((entry.until - Date.now()) / 1000) : 0;
}

/** Drop only entries whose last block ended more than STALE_MS ago. */
function prune() {
  const cutoff = Date.now() - STALE_MS;
  for (const [k, v] of failures) if (v.until < cutoff) failures.delete(k);
}

export function recordLoginFailure(key: string, freeAttempts = 5) {
  const count = (failures.get(key)?.count ?? 0) + 1;
  // `freeAttempts` free, then 2^n seconds, capped at 15 minutes.
  const delay = count <= freeAttempts ? 0 : Math.min(2 ** (count - freeAttempts), 900) * 1000;
  if (!failures.has(key) && failures.size >= MAX_ENTRIES) {
    prune();
    // Still full: don't evict live lockouts; loginBlockedFor() fails closed instead.
    if (failures.size >= MAX_ENTRIES) return;
  }
  failures.set(key, { count, until: Date.now() + delay });
}

export const clearLoginFailures = (key: string) => failures.delete(key);
