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

/** Sign the user out on every device, then start a fresh session here. */
export async function restartSessions(userId: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await createSession(userId);
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
