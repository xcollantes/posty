"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/calendar", "Calendar"],
  ["/posts", "Posts"],
  ["/queue", "Queue"],
  ["/media-library", "Media"],
  ["/accounts", "Accounts"],
  ["/snippets", "Snippets"],
  ["/tags", "Tags"],
  ["/analytics", "Analytics"],
  ["/settings", "Settings"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {LINKS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={path.startsWith(href) ? "page" : undefined}
          className="text-muted hover:text-fg hover:no-underline aria-[current=page]:font-medium aria-[current=page]:text-fg"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
