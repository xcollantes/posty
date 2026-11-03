"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  clearLoginFailures,
  createSession,
  destroySession,
  loginBlockedFor,
  recordLoginFailure,
  requireUser,
} from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { deleteMediaFiles } from "@/lib/media";
import { headers } from "next/headers";

type FormState = { error?: string; ok?: string } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ---- Session ----

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const h = await headers();
  const email = str(form, "email").toLowerCase();
  // Throttle per account as well as per client: the client key comes from
  // headers, which only `tailscale serve` can set reliably.
  const clientKey = `client:${(h.get("tailscale-user-login") ?? h.get("x-forwarded-for") ?? "local").slice(0, 200)}`;
  const tooMany = (s: number) => ({ error: `Too many attempts. Try again in ${s}s.` });
  if (loginBlockedFor(clientKey)) return tooMany(loginBlockedFor(clientKey));

  const [user] = email.length <= 320
    ? await db.select().from(schema.users).where(eq(schema.users.email, email))
    : [];
  const ok = !!user && (await verifyPassword(str(form, "password"), user.passwordHash));
  // Reason: the per-account limit is checked after the password, so someone
  // guessing can't lock the real owner out; only existing accounts are tracked.
  const emailKey = user ? `email:${user.userId}` : null;
  if (!ok) {
    recordLoginFailure(clientKey);
    if (emailKey) {
      recordLoginFailure(emailKey);
      if (loginBlockedFor(emailKey)) return tooMany(loginBlockedFor(emailKey));
    }
    return { error: "Wrong email or password" };
  }
  clearLoginFailures(clientKey);
  if (emailKey) clearLoginFailures(emailKey);
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
  await db.update(schema.media).set({ altText: altText.slice(0, 1500) }).where(eq(schema.media.mediaId, mediaId));
}

export async function deleteMedia(mediaId: string): Promise<{ error?: string }> {
  await requireUser();
  const [used] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from posts
    where status in ('draft', 'scheduled') and (content::text like ${"%" + mediaId + "%"}
      or exists (select 1 from post_targets t where t.post_id = posts.post_id and t.content_override::text like ${"%" + mediaId + "%"}))`);
  if (used.n > 0) return { error: "Used by a draft or scheduled post" };
  const [row] = await db.delete(schema.media).where(eq(schema.media.mediaId, mediaId)).returning();
  if (row) await deleteMediaFiles(row.fileName);
  revalidatePath("/media-library");
  return {};
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
