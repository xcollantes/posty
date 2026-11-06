"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { clearLoginFailures, loginBlockedFor, recordLoginFailure } from "@/lib/throttle";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { deleteMediaIfUnused, MAX_ALT_TEXT } from "@/lib/media";
import { headers } from "next/headers";

type FormState = { error?: string; ok?: string } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ---- Session ----

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const h = await headers();
  const email = str(form, "email").toLowerCase();
  // Throttle per account as well as per client: the client key comes from
  // headers, which only `tailscale serve` can set reliably.
  if (email.length > 320) return { error: "Wrong email or password" };
  // Limits are checked before any password is tested (fail closed), and every
  // attempted email is tracked alike so responses don't reveal which accounts
  // exist. The client identity is only Tailscale-User-Login, which `tailscale
  // serve` sets and strips from client input; anything without it (tagged
  // devices, other proxies) shares one "unknown" bucket rather than trusting a
  // spoofable header. Limits, as [key, free attempts]:
  // - verified identity: email + identity (5) and identity (5). Identities
  //   can't be forged, so no account-wide key is needed and guessing from one
  //   device never locks out the owner's others.
  // - no identity: email + "unknown" (20), plus a total "unknown" key (50) so
  //   unidentified traffic can't mint unlimited keys and fill the throttle
  //   table. Both only slow other unidentified clients, never verified ones.
  // Every source is therefore capped before it can create many keys.
  const identity = h.get("tailscale-user-login")?.slice(0, 200);
  const limits: [string, number][] = identity
    ? [[`email:${email}|${identity}`, 5], [`client:${identity}`, 5]]
    : [[`email:${email}|unknown`, 20], ["client:unknown", 50]];
  const wait = Math.max(...limits.map(([key]) => loginBlockedFor(key)));
  if (wait) return { error: `Too many attempts. Try again in ${wait}s.` };

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user || !(await verifyPassword(str(form, "password"), user.passwordHash))) {
    for (const [key, free] of limits) recordLoginFailure(key, free);
    return { error: "Wrong email or password" };
  }
  // The shared "unknown" total only decays with time; a success must not reset it.
  for (const [key] of limits) if (key !== "client:unknown") clearLoginFailures(key);
  await createSession(user.userId);
  redirect(safeNext(str(form, "next")));
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
  await requireUser();
  const kind = str(form, "kind") === "template" ? "template" : "hashtags";
  const name = str(form, "name");
  const body = str(form, "body");
  if (!name || !body) return { error: "Name and text are required" };
  await db.insert(schema.snippets).values({ kind, name, body });
  revalidatePath("/snippets");
  return { ok: "Saved" };
}

export async function deleteSnippet(snippetId: string) {
  await requireUser();
  await db.delete(schema.snippets).where(eq(schema.snippets.snippetId, snippetId));
  revalidatePath("/snippets");
}

export async function createTag(_prev: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const name = str(form, "name");
  if (!name) return { error: "Name is required" };
  const color = /^#[0-9a-f]{6}$/i.test(str(form, "color")) ? str(form, "color") : "#0ea5e9";
  await db.insert(schema.tags).values({ name, color }).onConflictDoUpdate({ target: schema.tags.name, set: { color } });
  revalidatePath("/tags");
  return { ok: "Saved" };
}

export async function deleteTag(tagId: string) {
  await requireUser();
  await db.delete(schema.tags).where(eq(schema.tags.tagId, tagId));
  revalidatePath("/tags");
}

export async function addQueueSlot(_prev: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const time = str(form, "time");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "Pick a time" };
  const days = form.getAll("day").map(Number).filter((d) => d >= 0 && d <= 6);
  if (!days.length) return { error: "Pick at least one day" };
  await db.insert(schema.queueSlots).values(days.map((dayOfWeek) => ({ dayOfWeek, time })));
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

export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const [row] = await db.select().from(schema.users).where(eq(schema.users.userId, user.userId));
  if (!(await verifyPassword(str(form, "current"), row.passwordHash))) return { error: "Current password is wrong" };
  const next = str(form, "next");
  if (next.length < 10) return { error: "Use at least 10 characters" };
  await db.update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.userId, user.userId));
  // Sign out every other session.
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.userId));
  await createSession(user.userId);
  return { ok: "Password changed" };
}

export async function createUser(_prev: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { error: "Enter a valid email" };
  if (password.length < 10) return { error: "Use at least 10 characters" };
  try {
    await db.insert(schema.users).values({
      email,
      name: str(form, "name") || email.split("@")[0],
      passwordHash: await hashPassword(password),
    });
  } catch {
    return { error: "That email is already in use" };
  }
  revalidatePath("/settings");
  return { ok: "User added" };
}

export async function deleteUser(userId: string) {
  const me = await requireUser();
  if (me.userId === userId) return;
  await db.delete(schema.users).where(eq(schema.users.userId, userId));
  revalidatePath("/settings");
}
