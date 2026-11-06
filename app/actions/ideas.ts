"use server";

import { TZDate } from "@date-fns/tz";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createIdeaGroup, deleteIdea, deleteIdeaGroup, ideaPostInput, saveIdea } from "@/lib/ideas";
import { NETWORK_IDS } from "@/lib/networks/catalog";
import { savePostAs } from "@/lib/posts";
import { requireWorkspace } from "@/lib/workspaces";

type FormState = { error?: string; ok?: string } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Noon that day in the user's timezone, so the date reads the same everywhere it's shown. */
function targetAt(value: string, timezone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, timezone).toISOString() : null;
}

export async function saveIdeaForm(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspaceId } = await requireWorkspace();
  const ideaId = str(form, "ideaId") || undefined;
  const result = await saveIdea(
    {
      workspaceId,
      title: str(form, "title").slice(0, 300),
      text: str(form, "text"),
      mediaIds: form.getAll("mediaId").map(String),
      networks: form.getAll("network").map(String).filter((n) => (NETWORK_IDS as readonly string[]).includes(n)),
      tags: str(form, "tags").split(","),
      ideaGroupId: str(form, "ideaGroupId") || null,
      targetAt: targetAt(str(form, "targetAt"), user.timezone),
    },
    ideaId,
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/ideas");
  // Reason: back to a clean URL, which also leaves edit mode.
  redirect("/ideas");
}

export async function moveIdea(ideaId: string, ideaGroupId: string) {
  await requireUser();
  await saveIdea({ ideaGroupId: ideaGroupId || null }, ideaId);
  revalidatePath("/ideas");
}

export async function removeIdea(ideaId: string) {
  await requireUser();
  await deleteIdea(ideaId);
  revalidatePath("/ideas");
}

export async function addIdeaGroup(_prev: FormState, form: FormData): Promise<FormState> {
  const { workspaceId } = await requireWorkspace();
  const name = str(form, "name").slice(0, 100);
  if (!name) return { error: "Name is required" };
  await createIdeaGroup(workspaceId, name);
  revalidatePath("/ideas");
  return { ok: "Added" };
}

export async function removeIdeaGroup(ideaGroupId: string) {
  await requireUser();
  await deleteIdeaGroup(ideaGroupId);
  revalidatePath("/ideas");
}

/** Turn an idea into a draft and open it. The draft now holds the content, so the idea goes. */
export async function ideaToPost(ideaId: string) {
  const user = await requireUser();
  const input = await ideaPostInput(ideaId);
  if (!input) redirect("/ideas");
  const result = await savePostAs(user, { ...input, mode: "draft" });
  if (!result.ok) throw new Error(result.error);
  await deleteIdea(ideaId);
  revalidatePath("/", "layout");
  redirect(`/compose/${result.postId}`);
}
