import type { Metadata } from "next";
import { inArray } from "drizzle-orm";
import { Pencil, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { addIdeaGroup, ideaToPost, removeIdea, removeIdeaGroup } from "@/app/actions/ideas";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { rowToMedia } from "@/components/composer/media";
import type { ComposerMedia } from "@/components/composer/types";
import { Card, Page } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { listIdeaGroups, listIdeas } from "@/lib/ideas";
import { NETWORKS, type NetworkId } from "@/lib/networks/catalog";
import { IdeaForm, MoveIdea } from "./IdeaForm";

export const metadata: Metadata = { title: "Ideas" };

export default async function IdeasPage({ searchParams }: PageProps<"/ideas">) {
  const user = await requireUser();
  const { edit } = await searchParams;
  const [groups, ideas] = await Promise.all([listIdeaGroups(), listIdeas()]);

  const mediaIds = [...new Set(ideas.flatMap((i) => i.mediaIds))];
  const mediaRows = mediaIds.length
    ? await db.select().from(schema.media).where(inArray(schema.media.mediaId, mediaIds))
    : [];
  const media = new Map(mediaRows.map((r) => [r.mediaId, rowToMedia(r)]));
  const mediaFor = (ids: string[]) => ids.flatMap((id): ComposerMedia[] => (media.has(id) ? [media.get(id)!] : []));

  const editing = ideas.find((i) => i.ideaId === edit);
  const shown = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: user.timezone });
  // en-CA writes dates as YYYY-MM-DD, which is what <input type="date"> takes.
  const inputDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: user.timezone,
  });
  const columns = [{ ideaGroupId: null, name: "Unsorted" }, ...groups];

  return (
    <Page title="Ideas" description="Rough content for later. Nothing here gets published until you turn it into a post.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div
          role="region"
          aria-label="Ideas board"
          tabIndex={0}
          className="flex min-w-0 items-start gap-4 overflow-x-auto rounded-2xl pb-2"
        >
          {columns.map((column) => {
            const cards = ideas.filter((i) => i.ideaGroupId === column.ideaGroupId);
            return (
              <section key={column.ideaGroupId ?? "unsorted"} className="card w-72 shrink-0">
                <div className="flex h-14 items-center gap-2 border-b border-line px-4">
                  <h2 className="min-w-0 flex-1 truncate">{column.name}</h2>
                  <span className="chip bg-soft text-muted">{cards.length}</span>
                  {column.ideaGroupId && (
                    <ActionButton
                      action={removeIdeaGroup.bind(null, column.ideaGroupId)}
                      label={<Trash2 className="size-4" />}
                      title={`Delete column ${column.name}`}
                      confirm={`Delete the column "${column.name}"? Its ideas move to Unsorted.`}
                      className="icon-btn icon-btn-danger"
                    />
                  )}
                </div>
                {cards.length === 0 ? (
                  <p className="hint p-4">No ideas here.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {cards.map((idea) => {
                      const files = mediaFor(idea.mediaIds);
                      return (
                        <li key={idea.ideaId} className="space-y-2 p-4">
                          {idea.title && <h3 className="break-words font-semibold">{idea.title}</h3>}
                          {idea.text && (
                            <p className="line-clamp-5 whitespace-pre-wrap break-words text-sm text-muted">{idea.text}</p>
                          )}
                          {files.length > 0 && (
                            <ul className="grid grid-cols-3 gap-1.5">
                              {files.map((m) => (
                                <li key={m.mediaId} className="aspect-square overflow-hidden rounded-lg bg-soft">
                                  {m.kind === "video" ? (
                                    <video src={m.src} className="size-full object-cover" muted preload="metadata" />
                                  ) : (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={m.src} alt={m.altText} className="size-full object-cover" loading="lazy" />
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {(idea.tags.length > 0 || idea.networks.length > 0 || idea.targetAt) && (
                            <div className="flex flex-wrap gap-1.5">
                              {idea.targetAt && <span className="chip bg-link/12 text-link">{shown.format(idea.targetAt)}</span>}
                              {idea.networks.map((n) => (
                                <span key={n} className="chip bg-soft text-muted">
                                  {NETWORKS[n as NetworkId]?.label ?? n}
                                </span>
                              ))}
                              {idea.tags.map((t) => (
                                <span key={t.name} className="chip bg-soft text-muted">
                                  <span className="size-2 rounded-full" style={{ background: t.color }} />
                                  {t.name}
                                </span>
                              ))}
                            </div>
                          )}
                          {groups.length > 0 && <MoveIdea ideaId={idea.ideaId} ideaGroupId={idea.ideaGroupId} groups={groups} />}
                          <div className="flex items-center gap-1">
                            <ActionButton
                              action={ideaToPost.bind(null, idea.ideaId)}
                              label={
                                <>
                                  <Send className="size-4" />
                                  Turn into post
                                </>
                              }
                              className="btn"
                            />
                            <span className="flex-1" />
                            <Link
                              href={`/ideas?edit=${idea.ideaId}`}
                              className="icon-btn"
                              title="Edit"
                              aria-label={`Edit ${idea.title || "idea"}`}
                            >
                              <Pencil className="size-4" />
                            </Link>
                            <ActionButton
                              action={removeIdea.bind(null, idea.ideaId)}
                              label={<Trash2 className="size-4" />}
                              title="Delete"
                              confirm="Delete this idea? Its files stay in the media library."
                              className="icon-btn icon-btn-danger"
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <div className="space-y-6">
          <Card title={editing ? "Edit idea" : "Add an idea"}>
            <IdeaForm
              // Reason: starts fresh after each save, since a redirect to /ideas keeps client state.
              key={`${editing?.ideaId ?? "new"}-${ideas.length}`}
              groups={groups}
              initialMedia={editing ? mediaFor(editing.mediaIds) : []}
              initial={
                editing && {
                  ideaId: editing.ideaId,
                  title: editing.title,
                  text: editing.text,
                  networks: editing.networks,
                  tags: editing.tags.map((t) => t.name).join(", "),
                  ideaGroupId: editing.ideaGroupId,
                  targetAt: editing.targetAt ? inputDate.format(editing.targetAt) : "",
                }
              }
            />
          </Card>
          <Card title="Add a column">
            <ActionForm action={addIdeaGroup} submitLabel="Add column" className="space-y-4">
              <label className="block text-sm font-semibold">
                Name
                <input name="name" className="input mt-1.5" maxLength={100} required />
              </label>
            </ActionForm>
          </Card>
        </div>
      </div>
    </Page>
  );
}
