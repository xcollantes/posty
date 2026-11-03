import { TZDate } from "@date-fns/tz";

export type Slot = { dayOfWeek: number; time: string };

/**
 * Next queue slot after `now` that isn't already taken.
 * Slots are wall-clock times in `timeZone`, so DST shifts keep "9:00" at 9:00.
 */
export function nextFreeSlot(
  slots: Slot[],
  taken: Date[],
  timeZone: string,
  now = new Date(),
  weeksAhead = 12,
): Date | null {
  if (!slots.length) return null;
  const takenSet = new Set(taken.map((d) => Math.floor(d.getTime() / 60_000)));
  const local = new TZDate(now.getTime(), timeZone);
  const sorted = [...slots].sort((a, b) => a.time.localeCompare(b.time));

  for (let day = 0; day < weeksAhead * 7; day++) {
    const y = local.getFullYear();
    const m = local.getMonth();
    const d = local.getDate() + day;
    const dow = new TZDate(y, m, d, 12, 0, timeZone).getDay();
    for (const slot of sorted) {
      if (slot.dayOfWeek !== dow) continue;
      const [hh, mm] = slot.time.split(":").map(Number);
      const at = new TZDate(y, m, d, hh, mm, timeZone);
      if (at.getTime() <= now.getTime()) continue;
      if (takenSet.has(Math.floor(at.getTime() / 60_000))) continue;
      return new Date(at.getTime());
    }
  }
  return null;
}
