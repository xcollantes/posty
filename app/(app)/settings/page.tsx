import { asc } from "drizzle-orm";
import { changePassword, createUser, deleteUser, updateProfile } from "@/app/actions/library";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export default async function SettingsPage() {
  const me = await requireUser();
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.createdAt));
  const zones = Intl.supportedValuesOf("timeZone");
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="card">
        <h2 className="mb-3 font-medium">Profile</h2>
        <ActionForm action={updateProfile}>
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" defaultValue={me.name} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="timezone">Timezone (used by the queue)</label>
            <select id="timezone" name="timezone" defaultValue={me.timezone} className="input">
              {!zones.includes(me.timezone) && <option value={me.timezone}>{me.timezone}</option>}
              {zones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">Change password</h2>
        <ActionForm action={changePassword}>
          <div>
            <label className="label" htmlFor="current">Current password</label>
            <input id="current" name="current" type="password" autoComplete="current-password" className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="next">New password</label>
            <input id="next" name="next" type="password" autoComplete="new-password" minLength={10} className="input" required />
          </div>
        </ActionForm>
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">Users</h2>
        <ul className="divide-y divide-border">
          {users.map((u) => (
            <li key={u.userId} className="flex items-center justify-between py-2 text-sm">
              <span>
                {u.name} <span className="text-muted">· {u.email}</span>
              </span>
              {u.userId !== me.userId && (
                <ActionButton action={deleteUser.bind(null, u.userId)} label="Remove" confirm={`Remove ${u.email}?`} />
              )}
            </li>
          ))}
        </ul>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Add a user</summary>
          <ActionForm action={createUser} className="mt-3 space-y-3" submitLabel="Add user">
            <input name="name" placeholder="Name" className="input" />
            <input name="email" type="email" placeholder="Email" className="input" required />
            <input name="password" type="password" placeholder="Password (10+ characters)" minLength={10} className="input" required />
          </ActionForm>
        </details>
      </section>
    </div>
  );
}
