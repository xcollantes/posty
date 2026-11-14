import type { Metadata } from "next";
import { asc, eq, sql } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import {
  createUser,
  deletePasskey,
  deleteUser,
  newSignInLink,
  updateProfile,
} from "@/app/actions/library";
import { createWorkspace, deleteWorkspace, renameWorkspace } from "@/app/actions/workspaces";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { AddPasskey } from "@/components/AddPasskey";
import { Card, Page } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { listWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.createdAt));
  const passkeys = await db
    .select()
    .from(schema.passkeys)
    .where(eq(schema.passkeys.userId, me.userId))
    .orderBy(asc(schema.passkeys.createdAt));
  const day = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: me.timezone });
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

        <Card title="Passkeys" hint="Add one on each device you sign in from." flush>
          <ul className="divide-y divide-line">
            {passkeys.map((p) => (
              <li key={p.passkeyId} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">Added {day(p.createdAt)}</p>
                  <p className="text-muted">{p.lastUsedAt ? `Last used ${day(p.lastUsedAt)}` : "Not used to sign in yet"}</p>
                </div>
                {passkeys.length > 1 && (
                  <ActionButton
                    action={deletePasskey.bind(null, p.passkeyId)}
                    label={<Trash2 className="size-4" />}
                    title="Remove passkey"
                    confirm="Remove this passkey? The device that holds it can no longer sign in."
                    className="icon-btn icon-btn-danger"
                  />
                )}
              </li>
            ))}
          </ul>
          <div className="px-5 py-4">
            <AddPasskey />
          </div>
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
              <li key={u.userId} className="flex items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{u.name || u.email}</p>
                  {u.name && <p className="truncate text-sm text-muted">{u.email}</p>}
                  {u.userId !== me.userId && (
                    // For a new device, or after losing one.
                    <ActionForm action={newSignInLink.bind(null, u.userId)} submitLabel="New sign-in link" className="mt-2" />
                  )}
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

        <Card title="Add a user" hint="You get a one-time link to send them. They create a passkey with it.">
          <ActionForm action={createUser} submitLabel="Add user" className="space-y-4">
            <label className="block text-sm font-semibold">
              Name
              <input name="name" className="input mt-1.5" />
            </label>
            <label className="block text-sm font-semibold">
              Email
              <input name="email" type="email" className="input mt-1.5" required />
            </label>
          </ActionForm>
        </Card>
      </div>
    </Page>
  );
}
