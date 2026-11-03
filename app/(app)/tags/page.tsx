import { asc } from "drizzle-orm";
import { createTag, deleteTag } from "@/app/actions/library";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export default async function TagsPage() {
  await requireUser();
  const tags = await db.select().from(schema.tags).orderBy(asc(schema.tags.name));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">Tags</h1>
        <p className="text-sm text-muted">Label posts by campaign or topic. Tag colors show on the calendar.</p>
        {tags.length === 0 && <p className="text-sm text-muted">No tags yet.</p>}
        <ul className="space-y-2">
          {tags.map((t) => (
            <li key={t.tagId} className="card flex items-center gap-3">
              <span className="h-4 w-4 rounded-full" style={{ background: t.color }} />
              <span className="flex-1 text-sm font-medium">{t.name}</span>
              <ActionButton action={deleteTag.bind(null, t.tagId)} label="Delete" confirm={`Delete tag "${t.name}"?`} />
            </li>
          ))}
        </ul>
      </section>
      <section className="card h-fit">
        <h2 className="mb-3 font-medium">New tag</h2>
        <ActionForm action={createTag}>
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="color">Color</label>
            <input id="color" name="color" type="color" defaultValue="#0ea5e9" className="h-9 w-16 cursor-pointer rounded border border-border" />
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
