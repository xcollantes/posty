import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { createSnippet, deleteSnippet } from "@/app/actions/library";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Snippets" };

export default async function SnippetsPage() {
  await requireUser();
  const snippets = await db.select().from(schema.snippets).orderBy(asc(schema.snippets.kind), asc(schema.snippets.name));
  return (
    <div className="max-w-3xl">
      <h1>Snippets</h1>
      <p className="hint mt-1">Hashtag groups and templates you can drop into a post from the composer.</p>

      {snippets.length === 0 ? (
        <p className="mt-6 text-muted">No snippets yet.</p>
      ) : (
        <table className="data-table mt-4">
          <thead>
            <tr>
              <th className="w-40">Name</th>
              <th className="w-24">Type</th>
              <th>Text</th>
              <th className="w-1">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {snippets.map((s) => (
              <tr key={s.snippetId}>
                <td>{s.name}</td>
                <td className="text-muted">{s.kind === "hashtags" ? "Hashtags" : "Template"}</td>
                <td className="whitespace-pre-wrap break-words">{s.body}</td>
                <td>
                  <ActionButton action={deleteSnippet.bind(null, s.snippetId)} label="Delete" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-8">Add a snippet</h2>
      <ActionForm action={createSnippet} submitLabel="Add snippet" className="mt-2 max-w-md space-y-3">
        <label className="block text-sm">
          Name
          <input name="name" className="input mt-1" required />
        </label>
        <label className="block text-sm">
          Type
          <select name="kind" className="input mt-1">
            <option value="hashtags">Hashtags</option>
            <option value="template">Template</option>
          </select>
        </label>
        <label className="block text-sm">
          Text
          <textarea name="body" rows={4} className="input mt-1" required placeholder="#coffee #specialtycoffee" />
        </label>
      </ActionForm>
    </div>
  );
}
