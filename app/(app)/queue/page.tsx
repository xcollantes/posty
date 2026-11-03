import { and, asc, isNotNull, ne } from "drizzle-orm";
import { addQueueSlot, deleteQueueSlot } from "@/app/actions/library";
import { ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { nextFreeSlot } from "@/lib/queue";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function QueuePage() {
  const user = await requireUser();
  const slots = await db.select().from(schema.queueSlots).orderBy(asc(schema.queueSlots.time));
  const taken = await db
    .select({ at: schema.posts.scheduledAt })
    .from(schema.posts)
    .where(and(isNotNull(schema.posts.scheduledAt), ne(schema.posts.status, "draft")));

  // Preview the next few free slots, as "Add to queue" would assign them.
  const upcoming: Date[] = [];
  const takenDates = taken.map((t) => t.at!);
  for (let i = 0; i < 5; i++) {
    const next = nextFreeSlot(slots, [...takenDates, ...upcoming], user.timezone);
    if (!next) break;
    upcoming.push(next);
  }
  const fmt = new Intl.DateTimeFormat("en", { weekday: "short", dateStyle: undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: user.timezone });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Queue schedule</h1>
        <p className="text-sm text-muted">
          &ldquo;Add to queue&rdquo; puts a post in the next free slot. Times are in {user.timezone} (change it in Settings).
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {DAYS.map((day, d) => (
          <div key={day} className="card space-y-1 p-3">
            <h2 className="text-sm font-medium">{day}</h2>
            {slots.filter((s) => s.dayOfWeek === d).length === 0 && <p className="text-xs text-muted">—</p>}
            {slots
              .filter((s) => s.dayOfWeek === d)
              .map((s) => (
                <form key={s.queueSlotId} action={deleteQueueSlot.bind(null, s.queueSlotId)} className="flex items-center justify-between text-sm">
                  <span className="font-mono">{s.time}</span>
                  <button className="text-xs text-muted hover:text-red-600" aria-label={`Remove ${day} ${s.time}`}>✕</button>
                </form>
              ))}
          </div>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-medium">Add a time slot</h2>
          <ActionForm action={addQueueSlot} submitLabel="Add">
            <fieldset className="flex flex-wrap gap-3">
              <legend className="label">Days</legend>
              {DAYS.map((day, d) => (
                <label key={day} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="day" value={d} defaultChecked={d >= 1 && d <= 5} />
                  {day}
                </label>
              ))}
            </fieldset>
            <div>
              <label className="label" htmlFor="time">Time</label>
              <input id="time" name="time" type="time" defaultValue="09:00" className="input max-w-[10rem]" required />
            </div>
          </ActionForm>
        </section>
        <section className="card">
          <h2 className="mb-3 font-medium">Next free slots</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">Add time slots to use the queue.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {upcoming.map((d) => (
                <li key={d.toISOString()}>{fmt.format(d)}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
