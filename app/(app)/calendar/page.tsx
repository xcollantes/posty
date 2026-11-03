import { requireUser } from "@/lib/auth";
import { CalendarView } from "./CalendarView";

export default async function CalendarPage() {
  await requireUser();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Calendar</h1>
      <div className="card">
        <CalendarView />
      </div>
      <p className="text-xs text-muted">
        Click a time to write a post for it. Drag drafts and scheduled posts to move them.
      </p>
    </div>
  );
}
