import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { createTag, deleteTag } from "@/app/actions/library";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { Card, Page } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Tags" };

// The Instagram swatch the UI is built on, offered as tag colors.
const SWATCH = ["#f8d948", "#ef8132", "#e9336a", "#c127bf", "#6e3cf1"];

export default async function TagsPage() {
  const { workspaceId } = await requireWorkspace();
  const tags = await db.select().from(schema.tags).where(eq(schema.tags.workspaceId, workspaceId)).orderBy(asc(schema.tags.name));
  return (
    <Page
      title="Tags"
      description="Group posts by campaign or topic. A tag's color marks its posts on the calendar."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="All tags" flush>
          {tags.length === 0 ? (
            <p className="p-5 text-muted">No tags yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {tags.map((t) => (
                <li key={t.tagId} className="flex items-center gap-3 px-5 py-3">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: t.color }} />
                  <span className="flex-1 font-semibold">{t.name}</span>
                  <ActionButton
                    action={deleteTag.bind(null, t.tagId)}
                    label={<Trash2 className="size-4" />}
                    title="Delete"
                    confirm={`Delete the tag "${t.name}"?`}
                    className="icon-btn icon-btn-danger"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Add a tag">
          <ActionForm action={createTag} submitLabel="Add tag" className="space-y-4">
            <div className="flex items-end gap-3">
              <label className="block flex-1 text-sm font-semibold">
                Name
                <input name="name" className="input mt-1.5" required />
              </label>
              <label className="block text-sm font-semibold">
                Color
                <input
                  name="color"
                  type="color"
                  defaultValue={SWATCH[4]}
                  list="tag-swatch"
                  className="mt-1.5 block h-[38px] w-14 cursor-pointer rounded-xl border border-line bg-bg p-1"
                />
              </label>
              <datalist id="tag-swatch">
                {SWATCH.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </ActionForm>
        </Card>
      </div>
    </Page>
  );
}
