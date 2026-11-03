import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { changePassword, createUser, deleteUser, updateProfile } from "@/app/actions/library";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.createdAt));
  const zones = Intl.supportedValuesOf("timeZone");
  return (
    <div className="max-w-lg">
      <h1>Settings</h1>
      <p className="hint mt-1">Signed in as {me.email}.</p>

      <h2 className="mt-8">Profile</h2>
      <ActionForm action={updateProfile} className="mt-2 space-y-3">
        <label className="block text-sm">
          Name
          <input name="name" defaultValue={me.name} className="input mt-1" />
        </label>
        <label className="block text-sm">
          Timezone <span className="text-muted">(used by the queue)</span>
          <select name="timezone" defaultValue={me.timezone} className="input mt-1">
            {!zones.includes(me.timezone) && <option value={me.timezone}>{me.timezone}</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </ActionForm>

      <h2 className="mt-10">Password</h2>
      <ActionForm action={changePassword} submitLabel="Change password" className="mt-2 space-y-3">
        <label className="block text-sm">
          Current password
          <input name="current" type="password" autoComplete="current-password" className="input mt-1" required />
        </label>
        <label className="block text-sm">
          New password <span className="text-muted">(at least 10 characters)</span>
          <input name="next" type="password" autoComplete="new-password" minLength={10} className="input mt-1" required />
        </label>
      </ActionForm>

      <h2 className="mt-10">Users</h2>
      <table className="data-table mt-2">
        <tbody>
          {users.map((u) => (
            <tr key={u.userId}>
              <td>{u.name}</td>
              <td className="text-muted">{u.email}</td>
              <td className="w-1">
                {u.userId === me.userId ? (
                  <span className="text-muted">You</span>
                ) : (
                  <ActionButton action={deleteUser.bind(null, u.userId)} label="Remove" confirm={`Remove ${u.email}?`} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-8">Add a user</h2>
      <ActionForm action={createUser} submitLabel="Add user" className="mt-2 space-y-3">
        <label className="block text-sm">
          Name
          <input name="name" className="input mt-1" />
        </label>
        <label className="block text-sm">
          Email
          <input name="email" type="email" className="input mt-1" required />
        </label>
        <label className="block text-sm">
          Password <span className="text-muted">(at least 10 characters)</span>
          <input name="password" type="password" autoComplete="new-password" minLength={10} className="input mt-1" required />
        </label>
      </ActionForm>
    </div>
  );
}
