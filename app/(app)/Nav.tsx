"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/calendar", "Calendar"],
  ["/posts", "Posts"],
  ["/accounts", "Accounts"],
  ["/media-library", "Media"],
  ["/queue", "Queue"],
  ["/snippets", "Snippets"],
  ["/tags", "Tags"],
  ["/analytics", "Analytics"],
  ["/settings", "Settings"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
      {LINKS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={path.startsWith(href) ? "page" : undefined}
          className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm hover:bg-background aria-[current=page]:bg-accent/10 aria-[current=page]:font-medium aria-[current=page]:text-accent"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
