import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { createTag, deleteTag } from "@/app/actions/library";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Tags" };

export default async function TagsPage() {
  await requireUser();
  const tags = await db.select().from(schema.tags).orderBy(asc(schema.tags.name));
  return (
    <div className="max-w-xl">
      <h1>Tags</h1>
      <p className="hint mt-1">Group posts by campaign or topic. A tag&apos;s color marks its posts on the calendar.</p>

      {tags.length === 0 ? (
        <p className="mt-6 text-muted">No tags yet.</p>
      ) : (
        <table className="data-table mt-4">
          <tbody>
            {tags.map((t) => (
              <tr key={t.tagId}>
                <td className="w-6">
                  <span className="inline-block size-3 rounded-[2px] align-middle" style={{ background: t.color }} />
                </td>
                <td>{t.name}</td>
                <td className="w-1">
                  <ActionButton action={deleteTag.bind(null, t.tagId)} label="Delete" confirm={`Delete the tag "${t.name}"?`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-8">Add a tag</h2>
      <ActionForm action={createTag} submitLabel="Add tag" className="mt-2 space-y-3">
        <div className="flex items-end gap-3">
          <label className="block flex-1 text-sm">
            Name
            <input name="name" className="input mt-1" required />
          </label>
          <label className="block text-sm">
            Color
            <input
              name="color"
              type="color"
              defaultValue="#2563eb"
              className="mt-1 block h-[31px] w-12 cursor-pointer rounded-[3px] border border-line bg-bg"
            />
          </label>
        </div>
      </ActionForm>
    </div>
  );
}
