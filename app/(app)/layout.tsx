import Link from "next/link";
import { and, eq, lt, or } from "drizzle-orm";
import { logout } from "@/app/actions/library";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { NETWORKS, type NetworkId } from "@/lib/networks/catalog";
import { daysFromNow } from "@/lib/time";
import { Nav } from "./Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const soon = daysFromNow(10);
  // Accounts that need attention: dead tokens, or LinkedIn tokens about to expire (no refresh).
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
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-7 gap-y-2 px-4 py-2.5">
          <Link href="/calendar" className="font-semibold text-fg hover:no-underline">
            Posty
          </Link>
          <Nav />
          <div className="ml-auto flex items-center gap-5 text-sm">
            <Link href="/compose" className="btn-primary">
              New post
            </Link>
            <form action={logout}>
              <button className="cursor-pointer text-muted hover:text-fg">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {attention.length > 0 && (
        <div className="bg-warn-bg text-warn-fg">
          <p className="mx-auto max-w-6xl px-4 py-2 text-sm">
            {attention.map((a) => `${a.name} (${NETWORKS[a.network as NetworkId]?.label ?? a.network})`).join(", ")}{" "}
            {attention.length === 1 ? "needs" : "need"} to be reconnected.{" "}
            <Link href="/accounts" className="text-warn-fg underline">
              Go to Accounts
            </Link>
          </p>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
