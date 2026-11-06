import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { createSnippet, deleteSnippet } from "@/app/actions/library";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { Card, Page } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Snippets" };

export default async function SnippetsPage() {
  const { workspaceId } = await requireWorkspace();
  const snippets = await db
    .select()
    .from(schema.snippets)
    .where(eq(schema.snippets.workspaceId, workspaceId))
    .orderBy(asc(schema.snippets.kind), asc(schema.snippets.name));
  return (
    <Page
      title="Snippets"
      description="Hashtag groups and templates you can drop into a post from the composer."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="Saved snippets" flush>
          {snippets.length === 0 ? (
            <p className="p-5 text-muted">No snippets yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {snippets.map((s) => (
                <li key={s.snippetId} className="flex items-start gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{s.name}</span>
                      <span className={`chip ${s.kind === "hashtags" ? "bg-link/12 text-link" : "bg-soft text-muted"}`}>
                        {s.kind === "hashtags" ? "Hashtags" : "Template"}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{s.body}</p>
                  </div>
                  <ActionButton
                    action={deleteSnippet.bind(null, s.snippetId)}
                    label={<Trash2 className="size-4" />}
                    title="Delete"
                    className="icon-btn icon-btn-danger"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Add a snippet">
          <ActionForm action={createSnippet} submitLabel="Add snippet" className="space-y-4">
            <label className="block text-sm font-semibold">
              Name
              <input name="name" className="input mt-1.5" required />
            </label>
            <label className="block text-sm font-semibold">
              Type
              <select name="kind" className="input mt-1.5">
                <option value="hashtags">Hashtags</option>
                <option value="template">Template</option>
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Text
              <textarea name="body" rows={4} className="input mt-1.5" required placeholder="#coffee #specialtycoffee" />
            </label>
          </ActionForm>
        </Card>
      </div>
    </Page>
  );
}
