"use server";

import { count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { WORKSPACE_COOKIE } from "@/lib/workspaces";

type FormState = { error?: string; ok?: string } | undefined;
const nameOf = (form: FormData) => String(form.get("name") ?? "").trim().slice(0, 100);

export async function switchWorkspace(workspaceId: string) {
  await requireUser();
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    secure: appUrl().startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 86_400,
  });
}

export async function createWorkspace(_prev: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const name = nameOf(form);
  if (!name) return { error: "Name is required" };
  try {
    await db.insert(schema.workspaces).values({ name });
  } catch {
    return { error: "That name is already in use" };
  }
  revalidatePath("/", "layout");
  return { ok: "Added" };
}

export async function renameWorkspace(workspaceId: string, _prev: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const name = nameOf(form);
  if (!name) return { error: "Name is required" };
  try {
    await db.update(schema.workspaces).set({ name }).where(eq(schema.workspaces.workspaceId, workspaceId));
  } catch {
    return { error: "That name is already in use" };
  }
  revalidatePath("/", "layout");
  return { ok: "Saved" };
}

/** Foreign keys refuse this while the workspace has accounts, posts, ideas or media. */
export async function deleteWorkspace(workspaceId: string) {
  await requireUser();
  const [{ n }] = await db.select({ n: count() }).from(schema.workspaces);
  if (n <= 1) return;
  await db.delete(schema.workspaces).where(eq(schema.workspaces.workspaceId, workspaceId));
  revalidatePath("/", "layout");
}
