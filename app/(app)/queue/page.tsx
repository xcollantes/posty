import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { CalendarClock, X } from "lucide-react";
import { addQueueSlot, deleteQueueSlot } from "@/app/actions/library";
import { ActionForm } from "@/components/ActionForm";
import { Card, Page } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { nextFreeSlot } from "@/lib/queue";
import { requireWorkspace } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Queue" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "09:00" → "9:00 AM" */
const clock = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return clock.format(Date.UTC(2000, 0, 1, h, m));
};

export default async function QueuePage() {
  const { user, workspaceId } = await requireWorkspace();
  const slots = await db
    .select()
    .from(schema.queueSlots)
    .where(eq(schema.queueSlots.workspaceId, workspaceId))
    .orderBy(asc(schema.queueSlots.time));
  const taken = await db
    .select({ at: schema.posts.scheduledAt })
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), isNotNull(schema.posts.scheduledAt), ne(schema.posts.status, "draft")));

  // The next few free times, as "Add to queue" would hand them out.
  const upcoming: Date[] = [];
  const takenDates = taken.map((t) => t.at!);
  for (let i = 0; i < 5; i++) {
    const next = nextFreeSlot(slots, [...takenDates, ...upcoming], user.timezone);
    if (!next) break;
    upcoming.push(next);
  }
  const fmt = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: user.timezone,
  });

  return (
    <Page
      title="Queue"
      description={
        <>
          &ldquo;Add to queue&rdquo; puts a post in the next free time. Times are in {user.timezone} (
          <Link href="/settings">change</Link>).
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title="Weekly times" flush>
          <ul className="divide-y divide-line">
            {DAYS.map((day, d) => {
              const daySlots = slots.filter((s) => s.dayOfWeek === d);
              return (
                <li key={day} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <span className="w-24 font-semibold">{day}</span>
                  {daySlots.length === 0 ? (
                    <span className="text-sm text-muted">No times</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {daySlots.map((s) => (
                        <form
                          key={s.queueSlotId}
                          action={deleteQueueSlot.bind(null, s.queueSlotId)}
                          className="chip bg-soft py-1 pr-1 text-sm text-fg"
                        >
                          <span className="tabular-nums">{fmtTime(s.time)}</span>
                          <button
                            className="grid size-5 cursor-pointer place-items-center rounded-full text-muted hover:bg-danger/10 hover:text-danger"
                            title="Remove"
                            aria-label={`Remove ${day} ${fmtTime(s.time)}`}
                          >
                            <X className="size-3.5" />
                          </button>
                        </form>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card title="Add a time">
            <ActionForm action={addQueueSlot} submitLabel="Add" className="space-y-4">
              <fieldset className="flex flex-wrap gap-1.5">
                <legend className="sr-only">Days</legend>
                {DAYS.map((day, d) => (
                  <label key={day} className="pill-check px-2.5 py-1">
                    <input type="checkbox" name="day" value={d} defaultChecked={d >= 1 && d <= 5} />
                    {day.slice(0, 3)}
                  </label>
                ))}
              </fieldset>
              <label className="block text-sm font-semibold">
                At
                <input name="time" type="time" defaultValue="09:00" className="input mt-1.5" required />
              </label>
            </ActionForm>
          </Card>

          <Card title="Next free times">
            {upcoming.length === 0 ? (
              <p className="hint">Add a time to start using the queue.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {upcoming.map((d) => (
                  <li key={d.toISOString()} className="flex items-center gap-2">
                    <CalendarClock className="size-4 shrink-0 text-link" />
                    {fmt.format(d)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
