import type { Metadata } from "next";
import { Page } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { CalendarView } from "./CalendarView";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage() {
  await requireUser();
  return (
    <Page
      title="Calendar"
      description="Click a day to write a post for it. Drag a draft or scheduled post to move it."
    >
      <div className="card p-3 sm:p-5">
        <CalendarView />
      </div>
    </Page>
  );
}
