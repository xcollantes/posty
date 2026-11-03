import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { appUrl } from "@/lib/env";

const COOKIE = "posty_session";
const SESSION_DAYS = 30;

export type CurrentUser = { userId: string; email: string; name: string; timezone: string };

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ sessionId: sha256(token), userId, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: appUrl().startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await db.delete(schema.sessions).where(eq(schema.sessions.sessionId, sha256(token)));
  }
  jar.delete(COOKIE);
}

/** The signed-in user for this request, or null. Memoized per request. */
export const getUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({
      userId: schema.users.userId,
      email: schema.users.email,
      name: schema.users.name,
      timezone: schema.users.timezone,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.userId, schema.sessions.userId))
    .where(
      and(eq(schema.sessions.sessionId, sha256(token)), gt(schema.sessions.expiresAt, new Date())),
    );
  return row ?? null;
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

// ponytail: in-memory failed-login throttle; fine for one container behind a tailnet.
const failures = new Map<string, { count: number; until: number }>();

export function loginBlockedFor(key: string): number {
  const entry = failures.get(key);
  return entry && entry.until > Date.now() ? Math.ceil((entry.until - Date.now()) / 1000) : 0;
}

export function recordLoginFailure(key: string, freeAttempts = 5) {
  const count = (failures.get(key)?.count ?? 0) + 1;
  // `freeAttempts` free, then 2^n seconds, capped at 15 minutes.
  const delay = count <= freeAttempts ? 0 : Math.min(2 ** (count - freeAttempts), 900) * 1000;
  // Cap memory: drop the oldest entry (Map keeps insertion order).
  if (failures.size >= 10_000 && !failures.has(key)) failures.delete(failures.keys().next().value!);
  failures.delete(key);
  failures.set(key, { count, until: Date.now() + delay });
}

export const clearLoginFailures = (key: string) => failures.delete(key);
