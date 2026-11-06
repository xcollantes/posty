import type { Metadata } from "next";
import { asc, sql } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { changePassword, createUser, deleteUser, updateProfile } from "@/app/actions/library";
import { createWorkspace, deleteWorkspace, renameWorkspace } from "@/app/actions/workspaces";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { Card, Page } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { listWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.createdAt));
  const zones = Intl.supportedValuesOf("timeZone");
  // Only what blocks deleting a workspace (see the foreign keys in lib/db/schema.ts).
  const [workspaces, itemCounts] = await Promise.all([
    listWorkspaces(),
    db.execute<{ workspace_id: string; n: number }>(sql`
      select workspace_id, count(*)::int as n from (
        select workspace_id from social_accounts
        union all select workspace_id from posts
        union all select workspace_id from ideas
        union all select workspace_id from media
      ) as items group by workspace_id`),
  ]);
  const items = new Map(itemCounts.map((c) => [c.workspace_id, c.n]));
  return (
    <Page title="Settings" description={`Signed in as ${me.email}.`}>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <ActionForm action={updateProfile} className="space-y-4">
            <label className="block text-sm font-semibold">
              Name
              <input name="name" defaultValue={me.name} className="input mt-1.5" />
            </label>
            <label className="block text-sm font-semibold">
              Timezone <span className="font-normal text-muted">(used by the queue)</span>
              <select name="timezone" defaultValue={me.timezone} className="input mt-1.5">
                {!zones.includes(me.timezone) && <option value={me.timezone}>{me.timezone}</option>}
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
          </ActionForm>
        </Card>

        <Card title="Password">
          <ActionForm action={changePassword} submitLabel="Change password" className="space-y-4">
            <label className="block text-sm font-semibold">
              Current password
              <input name="current" type="password" autoComplete="current-password" className="input mt-1.5" required />
            </label>
            <label className="block text-sm font-semibold">
              New password <span className="font-normal text-muted">(at least 10 characters)</span>
              <input
                name="next"
                type="password"
                autoComplete="new-password"
                minLength={10}
                className="input mt-1.5"
                required
              />
            </label>
          </ActionForm>
        </Card>

        <Card
          title="Workspaces"
          hint="One per company. Each has its own accounts, posts, ideas, media, tags, snippets and queue."
          flush
        >
          <ul className="divide-y divide-line">
            {workspaces.map((w) => {
              const n = items.get(w.workspaceId) ?? 0;
              return (
                <li key={w.workspaceId} className="flex items-start gap-2 px-5 py-3">
                  <ActionForm action={renameWorkspace.bind(null, w.workspaceId)} className="min-w-0 flex-1 space-y-2">
                    <input
                      name="name"
                      defaultValue={w.name}
                      aria-label={`Name of ${w.name}`}
                      maxLength={100}
                      className="input"
                      required
                    />
                    <p className="hint">
                      {n === 1 ? "1 account, post, idea or file" : `${n} accounts, posts, ideas and files`}
                    </p>
                  </ActionForm>
                  {n === 0 && workspaces.length > 1 && (
                    <ActionButton
                      action={deleteWorkspace.bind(null, w.workspaceId)}
                      label={<Trash2 className="size-4" />}
                      title={`Delete ${w.name}`}
                      confirm={`Delete the workspace "${w.name}"? Its tags, snippets and queue times go with it.`}
                      className="icon-btn icon-btn-danger"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Add a workspace">
          <ActionForm action={createWorkspace} submitLabel="Add workspace" className="space-y-4">
            <label className="block text-sm font-semibold">
              Name
              <input name="name" maxLength={100} className="input mt-1.5" required />
            </label>
          </ActionForm>
        </Card>

        <Card title="Users" flush>
          <ul className="divide-y divide-line">
            {users.map((u) => (
              <li key={u.userId} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{u.name || u.email}</p>
                  {u.name && <p className="truncate text-sm text-muted">{u.email}</p>}
                </div>
                {u.userId === me.userId ? (
                  <span className="chip bg-link/12 text-link">You</span>
                ) : (
                  <ActionButton
                    action={deleteUser.bind(null, u.userId)}
                    label={<Trash2 className="size-4" />}
                    title="Remove"
                    confirm={`Remove ${u.email}?`}
                    className="icon-btn icon-btn-danger"
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Add a user">
          <ActionForm action={createUser} submitLabel="Add user" className="space-y-4">
            <label className="block text-sm font-semibold">
              Name
              <input name="name" className="input mt-1.5" />
            </label>
            <label className="block text-sm font-semibold">
              Email
              <input name="email" type="email" className="input mt-1.5" required />
            </label>
            <label className="block text-sm font-semibold">
              Password <span className="font-normal text-muted">(at least 10 characters)</span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                className="input mt-1.5"
                required
              />
            </label>
          </ActionForm>
        </Card>
      </div>
    </Page>
  );
}
