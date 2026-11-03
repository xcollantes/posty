import Link from "next/link";
import { and, eq, lt, or } from "drizzle-orm";
import { logout } from "@/app/actions/library";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { daysFromNow } from "@/lib/time";
import { Nav } from "./Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const soon = daysFromNow(10);
  // Accounts that need attention: dead tokens, or LinkedIn-style tokens that expire without refresh.
  const attention = await db
    .select({ name: schema.socialAccounts.name, network: schema.socialAccounts.network })
    .from(schema.socialAccounts)
    .where(
      and(
        eq(schema.socialAccounts.isActive, true),
        or(
          eq(schema.socialAccounts.needsReconnect, true),
          and(eq(schema.socialAccounts.network, "linkedin"), lt(schema.socialAccounts.expiresAt, soon)),
        ),
      ),
    );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-border bg-panel md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between p-4">
          <Link href="/calendar" className="text-lg font-semibold">Posty</Link>
          <Link href="/compose" className="btn-primary md:hidden">New post</Link>
        </div>
        <div className="hidden px-4 pb-3 md:block">
          <Link href="/compose" className="btn-primary w-full">New post</Link>
        </div>
        <Nav />
        <div className="hidden border-t border-border p-4 text-xs text-muted md:absolute md:bottom-0 md:block md:w-56">
          <div className="truncate">{user.email}</div>
          <form action={logout}>
            <button className="mt-1 underline cursor-pointer">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">
        {attention.length > 0 && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {attention.length === 1 ? "An account needs" : `${attention.length} accounts need`} reconnecting:{" "}
            {attention.map((a) => `${a.name} (${a.network})`).join(", ")}.{" "}
            <Link href="/accounts" className="font-medium underline">Go to accounts</Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
