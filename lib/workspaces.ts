import { asc } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const WORKSPACE_COOKIE = "posty_workspace";

// Reason: oldest first, so adding a workspace never changes the fallback below
// and moves a browser with no cookie to another company.
export const listWorkspaces = cache(() =>
  db.select().from(schema.workspaces).orderBy(asc(schema.workspaces.createdAt)),
);

/**
 * The workspace this browser has open. The migration creates the first one and
 * the last one can't be deleted, so there is always at least one. Anything that
 * can run without a browser (MCP, the worker) takes an explicit workspace id, so
 * nothing in lib/ outside this file reads the cookie.
 *
 * ponytail: per browser, not per tab. Two tabs follow whichever switched last.
 * Routes like /w/[id]/posts would fix that, at the cost of moving every page.
 *
 * ponytail: organises data, doesn't protect it. Every signed-in user can open
 * every workspace, and actions that take a row id don't check its workspace.
 * Restricted logins need a membership table, and each action in app/actions/
 * scoped.
 */
export const activeWorkspaceId = cache(async (): Promise<string> => {
  const all = await listWorkspaces();
  const id = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  return (all.find((w) => w.workspaceId === id) ?? all[0]).workspaceId;
});

export async function requireWorkspace() {
  const user = await requireUser();
  return { user, workspaceId: await activeWorkspaceId() };
}
