"use server";

import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { COSEALG, isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession, requireUser, restartSessions } from "@/lib/auth";
import { sign, unsign } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { deleteMediaIfUnused, MAX_ALT_TEXT } from "@/lib/media";
import { consumeSignInLink, findSignInLink, issueSignInLink, rp, SIGN_IN_LINK_DAYS } from "@/lib/passkeys";
import { requireWorkspace } from "@/lib/workspaces";

type FormState = { error?: string; ok?: string } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ---- Session (passkeys) ----

// The challenge lives in a short-lived signed cookie between the options
// call and the verify call. Registration also binds it to one user.
const CHALLENGE_COOKIE = "posty_webauthn";
type Challenge = { challenge: string; userId?: string };

async function saveChallenge(c: Challenge) {
  (await cookies()).set(CHALLENGE_COOKIE, sign(c, 300), {
    httpOnly: true,
    secure: appUrl().startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });
}

async function takeChallenge(): Promise<Challenge | null> {
  const jar = await cookies();
  const saved = unsign<Challenge>(jar.get(CHALLENGE_COOKIE)?.value);
  jar.delete(CHALLENGE_COOKIE);
  return saved;
}

const LINK_GONE = "This link expired or was already used. Ask another Posty user for a new one.";

// Reason: the library also offers ML-DSA-44 when Node has it, but that is
// experimental Web Crypto in Node 24; a Node upgrade could orphan such keys.
const ALGORITHMS = [COSEALG.EdDSA, COSEALG.ES256, COSEALG.RS256];

export async function passkeyLoginOptions() {
  // No allowCredentials: the browser offers any Posty passkey on the device.
  const options = await generateAuthenticationOptions({ rpID: rp().rpID, userVerification: "required" });
  await saveChallenge({ challenge: options.challenge });
  return options;
}

export async function passkeyLogin(response: AuthenticationResponseJSON, next: string): Promise<FormState> {
  const fail = { error: "That passkey isn't registered with Posty." };
  const saved = await takeChallenge();
  if (!saved || typeof response?.id !== "string") return { error: "Sign-in timed out. Try again." };
  const [key] = await db.select().from(schema.passkeys).where(eq(schema.passkeys.passkeyId, response.id));
  if (!key) return fail;
  const { rpID, origin } = rp();
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response,
      expectedChallenge: saved.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: key.passkeyId,
        publicKey: isoBase64URL.toBuffer(key.publicKey),
        counter: key.counter,
        transports: key.transports,
      },
      requireUserVerification: true,
    });
    if (!verified) return fail;
    await db
      .update(schema.passkeys)
      .set({ counter: authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(schema.passkeys.passkeyId, key.passkeyId));
  } catch {
    // Reason: `response` comes straight from the client; malformed fields throw.
    return fail;
  }
  await createSession(key.userId);
  redirect(safeNext(next));
}

/** Options for adding a passkey: to the signed-in user, or via a sign-in link. */
export async function passkeyRegisterOptions(token?: string) {
  const user = token ? await findSignInLink(token) : await requireUser();
  if (!user) return { error: LINK_GONE };
  const existing = await db
    .select({ id: schema.passkeys.passkeyId, transports: schema.passkeys.transports })
    .from(schema.passkeys)
    .where(eq(schema.passkeys.userId, user.userId));
  const { rpID, rpName } = rp();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: isoUint8Array.fromUTF8String(user.userId),
    attestationType: "none",
    excludeCredentials: existing,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: ALGORITHMS,
  });
  await saveChallenge({ challenge: options.challenge, userId: user.userId });
  return { options };
}

export async function passkeyRegister(response: RegistrationResponseJSON, token?: string): Promise<FormState> {
  const fail = { error: "Couldn't save that passkey. Try again." };
  const saved = await takeChallenge();
  if (!saved?.userId) return { error: "Timed out. Try again." };
  // Without a link, only the signed-in user may add to their own account.
  if (!token && (await requireUser()).userId !== saved.userId) return fail;
  const { rpID, origin } = rp();
  let credential;
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response,
      expectedChallenge: saved.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMS,
    });
    if (!verified) return fail;
    credential = registrationInfo.credential;
  } catch {
    return fail;
  }
  // Single use, and it must still belong to the user the options were for.
  if (token && (await consumeSignInLink(token)) !== saved.userId) return { error: LINK_GONE };
  try {
    // Plain insert, never upsert: a forged response can claim any credential ID.
    await db.insert(schema.passkeys).values({
      passkeyId: credential.id,
      userId: saved.userId,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
    });
  } catch {
    return { error: "That passkey is already registered." };
  }
  if (token) {
    // Links serve recovery and resets, so sign the account out everywhere
    // else. A link issued by someone else can't take over an account quietly.
    await restartSessions(saved.userId);
    redirect("/calendar");
  }
  revalidatePath("/settings");
  return { ok: "Passkey added" };
}

export async function deletePasskey(passkeyId: string) {
  const user = await requireUser();
  const mine = eq(schema.passkeys.userId, user.userId);
  const [{ n }] = await db.select({ n: count() }).from(schema.passkeys).where(mine);
  // Removing the last one would lock the user out.
  if (n <= 1) return;
  const removed = await db
    .delete(schema.passkeys)
    .where(and(mine, eq(schema.passkeys.passkeyId, passkeyId)))
    .returning({ passkeyId: schema.passkeys.passkeyId });
  // Usually a lost device: end the session it may still hold.
  if (removed.length) await restartSessions(user.userId);
  revalidatePath("/settings");
}

/** Only same-origin paths; rejects //host, /\host and control characters. */
function safeNext(next: string): string {
  if (!/^\/(?![\/\\])/.test(next) || /[\\\x00-\x1f]/.test(next)) return "/calendar";
  const base = new URL(appUrl());
  const target = new URL(next, base);
  // Check the normalized result too: "/a/..//evil.com" becomes "//evil.com".
  const path = `/${target.pathname.replace(/^[\/\\]+/, "")}`;
  return target.origin === base.origin ? `${path}${target.search}` : "/calendar";
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

// ---- Media ----

export async function updateAltText(mediaId: string, altText: string) {
  await requireUser();
  await db.update(schema.media).set({ altText: altText.slice(0, MAX_ALT_TEXT) }).where(eq(schema.media.mediaId, mediaId));
}

export async function deleteMedia(mediaId: string): Promise<{ error?: string }> {
  await requireUser();
  const result = await deleteMediaIfUnused(mediaId);
  if (!result.error) revalidatePath("/media-library");
  return result;
}

// ---- Snippets, tags, queue ----

export async function createSnippet(_prev: FormState, form: FormData): Promise<FormState> {
  const { workspaceId } = await requireWorkspace();
  const kind = str(form, "kind") === "template" ? "template" : "hashtags";
  const name = str(form, "name");
  const body = str(form, "body");
  if (!name || !body) return { error: "Name and text are required" };
  await db.insert(schema.snippets).values({ workspaceId, kind, name, body });
  revalidatePath("/snippets");
  return { ok: "Saved" };
}

export async function deleteSnippet(snippetId: string) {
  await requireUser();
  await db.delete(schema.snippets).where(eq(schema.snippets.snippetId, snippetId));
  revalidatePath("/snippets");
}

export async function createTag(_prev: FormState, form: FormData): Promise<FormState> {
  const { workspaceId } = await requireWorkspace();
  const name = str(form, "name");
  if (!name) return { error: "Name is required" };
  const color = /^#[0-9a-f]{6}$/i.test(str(form, "color")) ? str(form, "color") : "#0ea5e9";
  await db
    .insert(schema.tags)
    .values({ workspaceId, name, color })
    .onConflictDoUpdate({ target: [schema.tags.workspaceId, schema.tags.name], set: { color } });
  revalidatePath("/tags");
  return { ok: "Saved" };
}

export async function deleteTag(tagId: string) {
  await requireUser();
  await db.delete(schema.tags).where(eq(schema.tags.tagId, tagId));
  revalidatePath("/tags");
}

export async function addQueueSlot(_prev: FormState, form: FormData): Promise<FormState> {
  const { workspaceId } = await requireWorkspace();
  const time = str(form, "time");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "Pick a time" };
  const days = form.getAll("day").map(Number).filter((d) => d >= 0 && d <= 6);
  if (!days.length) return { error: "Pick at least one day" };
  await db.insert(schema.queueSlots).values(days.map((dayOfWeek) => ({ workspaceId, dayOfWeek, time })));
  revalidatePath("/queue");
  return { ok: "Added" };
}

export async function deleteQueueSlot(queueSlotId: string) {
  await requireUser();
  await db.delete(schema.queueSlots).where(eq(schema.queueSlots.queueSlotId, queueSlotId));
  revalidatePath("/queue");
}

// ---- Settings & users ----

export async function updateProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const timezone = str(form, "timezone");
  if (!Intl.supportedValuesOf("timeZone").includes(timezone) && timezone !== "UTC") return { error: "Unknown timezone" };
  await db
    .update(schema.users)
    .set({ name: str(form, "name") || user.name, timezone })
    .where(eq(schema.users.userId, user.userId));
  revalidatePath("/", "layout");
  return { ok: "Saved" };
}

export async function createUser(_prev: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const email = str(form, "email").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { error: "Enter a valid email" };
  let userId: string;
  try {
    [{ userId }] = await db
      .insert(schema.users)
      .values({ email, name: str(form, "name") || email.split("@")[0] })
      .returning({ userId: schema.users.userId });
  } catch {
    return { error: "That email is already in use" };
  }
  revalidatePath("/settings");
  return newSignInLink(userId);
}

/**
 * A one-time link for a user who has no passkey yet. Users with one can't get
 * links here, or any user could add a passkey to anyone's account; getting
 * them back in after losing every device takes server access (signin-link).
 */
export async function newSignInLink(userId: string): Promise<FormState> {
  await requireUser();
  const [{ n }] = await db.select({ n: count() }).from(schema.passkeys).where(eq(schema.passkeys.userId, userId));
  if (n > 0) return { error: "They already have a passkey. To reset it, run the signin-link script on the server." };
  const url = await issueSignInLink(userId);
  return { ok: `Send them this link (one use, valid ${SIGN_IN_LINK_DAYS} days): ${url}` };
}

export async function deleteUser(userId: string) {
  const me = await requireUser();
  if (me.userId === userId) return;
  await db.delete(schema.users).where(eq(schema.users.userId, userId));
  revalidatePath("/settings");
}
