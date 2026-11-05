import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { changePassword, createUser, deleteUser, updateProfile } from "@/app/actions/library";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { Card, Page } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.createdAt));
  const zones = Intl.supportedValuesOf("timeZone");
  return (
    <Page eyebrow="Account" title="Settings" description={`Signed in as ${me.email}.`}>
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
