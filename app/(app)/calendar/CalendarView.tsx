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

export function CalendarView() {
  const router = useRouter();
  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
      initialView="dayGridMonth"
      headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay" }}
      height="auto"
      nowIndicator
      editable
      eventStartEditable
      eventDurationEditable={false}
      displayEventEnd={false}
      events={async (info: EventSourceFuncArg) => {
        const events = await calendarEvents(info.start.toISOString(), info.end.toISOString());
        return events.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.start,
          backgroundColor: e.color,
          borderColor: e.color,
          editable: MOVABLE.has(e.status),
          classNames: e.status === "draft" ? ["opacity-60"] : [],
          extendedProps: { status: e.status, networks: e.networks },
        }));
      }}
      eventContent={(arg) => {
        const nets = (arg.event.extendedProps.networks as NetworkId[]) ?? [];
        return (
          <div className="flex min-w-0 items-center gap-1 overflow-hidden px-1 text-xs">
            <span className="shrink-0 font-medium">{arg.timeText}</span>
            {nets.map((n) => (
              <span key={n} className="inline-block h-2 w-2 shrink-0 rounded-full border border-white/70" style={{ background: NETWORKS[n]?.color }} title={NETWORKS[n]?.label} />
            ))}
            <span className="truncate">{arg.event.title}</span>
          </div>
        );
      }}
      eventClick={(arg) => router.push(`/compose/${arg.event.id}`)}
      eventDrop={async (arg) => {
        const res = await reschedulePost(arg.event.id, arg.event.start!.toISOString());
        if (!res.ok) {
          arg.revert();
          console.warn(res.error);
        }
      }}
      dateClick={(arg) => {
        // Month view clicks give midnight; default to 9:00 that day.
        const at = new Date(arg.date);
        if (arg.allDay) at.setHours(9, 0, 0, 0);
        if (at.getTime() < Date.now()) return;
        router.push(`/compose?at=${encodeURIComponent(at.toISOString())}`);
      }}
    />
  );
}
