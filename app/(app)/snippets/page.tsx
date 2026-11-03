import { asc } from "drizzle-orm";
import { createSnippet, deleteSnippet } from "@/app/actions/library";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export default async function SnippetsPage() {
  await requireUser();
  const snippets = await db.select().from(schema.snippets).orderBy(asc(schema.snippets.kind), asc(schema.snippets.name));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">Snippets</h1>
        <p className="text-sm text-muted">Hashtag groups and templates you can insert from the composer.</p>
        {snippets.length === 0 && <p className="text-sm text-muted">No snippets yet.</p>}
        <ul className="space-y-2">
          {snippets.map((s) => (
            <li key={s.snippetId} className="card flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {s.kind === "hashtags" ? "#" : "📝"} {s.name}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-muted">{s.body}</p>
              </div>
              <ActionButton action={deleteSnippet.bind(null, s.snippetId)} label="Delete" />
            </li>
          ))}
        </ul>
      </section>
      <section className="card h-fit">
        <h2 className="mb-3 font-medium">New snippet</h2>
        <ActionForm action={createSnippet}>
          <div>
            <label className="label" htmlFor="kind">Type</label>
            <select id="kind" name="kind" className="input">
              <option value="hashtags">Hashtag group</option>
              <option value="template">Template</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="body">Text</label>
            <textarea id="body" name="body" rows={5} className="input" required placeholder="#selfhosted #opensource" />
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
