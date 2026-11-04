import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { CalendarView } from "./CalendarView";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage() {
  await requireUser();
  return (
    <div>
      <h1 className="sr-only">Calendar</h1>
      <CalendarView />
      <p className="hint mt-3">Click a day to write a post for it. Drag a draft or scheduled post to move it.</p>
    </div>
  );
}
