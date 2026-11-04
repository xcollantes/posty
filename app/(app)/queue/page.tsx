import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, isNotNull, ne } from "drizzle-orm";
import { addQueueSlot, deleteQueueSlot } from "@/app/actions/library";
import { ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { nextFreeSlot } from "@/lib/queue";

export const metadata: Metadata = { title: "Queue" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "09:00" → "9:00 AM" */
const clock = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return clock.format(Date.UTC(2000, 0, 1, h, m));
};

export default async function QueuePage() {
  const user = await requireUser();
  const slots = await db.select().from(schema.queueSlots).orderBy(asc(schema.queueSlots.time));
  const taken = await db
    .select({ at: schema.posts.scheduledAt })
    .from(schema.posts)
    .where(and(isNotNull(schema.posts.scheduledAt), ne(schema.posts.status, "draft")));

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
    <div className="max-w-2xl">
      <h1>Queue</h1>
      <p className="hint mt-1">
        &ldquo;Add to queue&rdquo; puts a post in the next free time below. Times are in {user.timezone} (
        <Link href="/settings">change</Link>).
      </p>

      <table className="data-table mt-4">
        <tbody>
          {DAYS.map((day, d) => {
            const daySlots = slots.filter((s) => s.dayOfWeek === d);
            return (
              <tr key={day}>
                <td className="w-32">{day}</td>
                <td>
                  {daySlots.length === 0 ? (
                    <span className="text-muted">No times</span>
                  ) : (
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      {daySlots.map((s) => (
                        <form
                          key={s.queueSlotId}
                          action={deleteQueueSlot.bind(null, s.queueSlotId)}
                          className="inline-flex items-baseline gap-1.5"
                        >
                          <span className="tabular-nums">{fmtTime(s.time)}</span>
                          <button
                            className="cursor-pointer text-muted hover:text-danger"
                            title="Remove"
                            aria-label={`Remove ${day} ${fmtTime(s.time)}`}
                          >
                            ×
                          </button>
                        </form>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 className="mt-8">Add a time</h2>
      <ActionForm action={addQueueSlot} submitLabel="Add" className="mt-2 space-y-3">
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <legend className="sr-only">Days</legend>
          {DAYS.map((day, d) => (
            <label key={day} className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" name="day" value={d} defaultChecked={d >= 1 && d <= 5} />
              {day.slice(0, 3)}
            </label>
          ))}
        </fieldset>
        <label className="block text-sm">
          At
          <input name="time" type="time" defaultValue="09:00" className="input ml-2 w-auto" required />
        </label>
      </ActionForm>

      <h2 className="mt-8">Next free times</h2>
      {upcoming.length === 0 ? (
        <p className="hint mt-1">Add a time above to start using the queue.</p>
      ) : (
        <ul className="mt-1 text-sm">
          {upcoming.map((d) => (
            <li key={d.toISOString()}>{fmt.format(d)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
