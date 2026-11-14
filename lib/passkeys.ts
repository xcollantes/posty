/**
 * Passkey relying-party settings and one-time sign-in links. No next/*
 * imports, so scripts/signin-link.ts can use it.
 */
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { appUrl } from "@/lib/env";

export const SIGN_IN_LINK_DAYS = 7;

/** Passkeys are bound to APP_URL's hostname; changing it orphans them. */
export function rp() {
  const url = new URL(appUrl());
  return { rpID: url.hostname, origin: url.origin, rpName: "Posty" };
}

/** Replace the user's sign-in links with a fresh one and return its URL. */
export async function issueSignInLink(userId: string): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SIGN_IN_LINK_DAYS * 86_400_000);
  await db.transaction(async (tx) => {
    await tx.delete(schema.signInLinks).where(eq(schema.signInLinks.userId, userId));
    await tx.insert(schema.signInLinks).values({ signInLinkId: sha256(token), userId, expiresAt });
  });
  return `${appUrl()}/login/link/${token}`;
}

/** The user an unexpired link belongs to, without using it up. */
export async function findSignInLink(token: string) {
  const [row] = await db
    .select({ userId: schema.users.userId, email: schema.users.email, name: schema.users.name })
    .from(schema.signInLinks)
    .innerJoin(schema.users, eq(schema.users.userId, schema.signInLinks.userId))
    .where(
      and(eq(schema.signInLinks.signInLinkId, sha256(token)), gt(schema.signInLinks.expiresAt, new Date())),
    );
  return row ?? null;
}

/** Use up a link. Returns its userId, or null if expired or already used. */
export async function consumeSignInLink(token: string): Promise<string | null> {
  const [row] = await db
    .delete(schema.signInLinks)
    .where(
      and(eq(schema.signInLinks.signInLinkId, sha256(token)), gt(schema.signInLinks.expiresAt, new Date())),
    )
    .returning({ userId: schema.signInLinks.userId });
  return row?.userId ?? null;
}
