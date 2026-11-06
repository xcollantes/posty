"use client";

import { CalendarDays, ChartColumn, Clock, Hash, ImageIcon, LayoutList, Lightbulb, Settings, Tag, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/calendar", "Calendar", CalendarDays],
  ["/posts", "Posts", LayoutList],
  ["/ideas", "Ideas", Lightbulb],
  ["/queue", "Queue", Clock],
  ["/media-library", "Media", ImageIcon],
  ["/accounts", "Accounts", Users],
  ["/snippets", "Snippets", Hash],
  ["/tags", "Tags", Tag],
  ["/analytics", "Analytics", ChartColumn],
  ["/settings", "Settings", Settings],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    // On phones the row scrolls sideways instead of wrapping.
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-3 [scrollbar-width:none]">
      {LINKS.map(([href, label, Icon]) => (
        <Link
          key={href}
          href={href}
          aria-current={path.startsWith(href) ? "page" : undefined}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold text-chrome-muted hover:bg-white/5 hover:text-white hover:no-underline aria-[current=page]:bg-white/10 aria-[current=page]:text-white"
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
