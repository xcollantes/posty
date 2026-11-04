"use client";

import type { EventSourceFuncArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { useRouter } from "next/navigation";
import { calendarEvents, reschedulePost } from "@/app/actions/posts";
import { NETWORKS, type NetworkId } from "@/lib/networks/catalog";

// Failed posts aren't movable: a drag can't re-queue them, use Retry instead.
const MOVABLE = new Set(["draft", "scheduled"]);
// Exactly one color class per status (events render inside <a>, which is link-colored).
const STATUS_CLASS: Record<string, string> = {
  scheduled: "text-fg",
  draft: "italic text-muted",
  published: "text-muted",
  partial: "text-muted",
  failed: "text-danger",
};

type Extra = { status: string; networks: NetworkId[]; tagColor: string | null };

export function CalendarView() {
  const router = useRouter();
  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
      initialView="dayGridMonth"
      headerToolbar={{ left: "title", center: "", right: "today prev,next dayGridMonth,timeGridWeek" }}
      buttonText={{ today: "Today", month: "Month", week: "Week" }}
      height="auto"
      nowIndicator
      editable
      eventDurationEditable={false}
      displayEventEnd={false}
      dayMaxEvents={4}
      eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
      events={async (info: EventSourceFuncArg) => {
        const events = await calendarEvents(info.start.toISOString(), info.end.toISOString());
        return events.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.start,
          editable: MOVABLE.has(e.status),
          backgroundColor: "transparent",
          borderColor: "transparent",
          textColor: "inherit",
          extendedProps: { status: e.status, networks: e.networks as NetworkId[], tagColor: e.tagColor } satisfies Extra,
        }));
      }}
      eventContent={(arg) => {
        const { status, networks, tagColor } = arg.event.extendedProps as Extra;
        const where = networks.map((n) => NETWORKS[n]?.label ?? n).join(", ");
        return (
          <div
            className={`flex min-w-0 gap-1.5 overflow-hidden text-[13px] leading-snug ${STATUS_CLASS[status] ?? "text-fg"}`}
            style={tagColor ? { borderLeft: `2px solid ${tagColor}`, paddingLeft: 4 } : undefined}
            title={`${where}${status === "scheduled" ? "" : ` (${status})`}: ${arg.event.title}`}
          >
            <span className="shrink-0 tabular-nums text-muted">{arg.timeText}</span>
            <span className="truncate">{arg.event.title}</span>
          </div>
        );
      }}
      eventClick={(arg) => router.push(`/compose/${arg.event.id}`)}
      eventDrop={async (arg) => {
        const res = await reschedulePost(arg.event.id, arg.event.start!.toISOString());
        if (!res.ok) {
          arg.revert();
          window.alert(res.error);
        }
      }}
      dateClick={(arg) => {
        // Month view gives midnight; default to 9:00 that day.
        const at = new Date(arg.date);
        if (arg.allDay) at.setHours(9, 0, 0, 0);
        if (at.getTime() < Date.now()) return;
        router.push(`/compose?at=${encodeURIComponent(at.toISOString())}`);
      }}
    />
  );
}
