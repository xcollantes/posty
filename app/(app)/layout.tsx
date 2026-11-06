import Link from "next/link";
import { and, eq, lt, or } from "drizzle-orm";
import { LogOut, Plus, TriangleAlert } from "lucide-react";
import { logout } from "@/app/actions/library";
import { Logo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { NETWORKS, type NetworkId } from "@/lib/networks/catalog";
import { daysFromNow } from "@/lib/time";
import { activeWorkspaceId, listWorkspaces } from "@/lib/workspaces";
import { Nav } from "./Nav";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const soon = daysFromNow(10);
  const [workspaces, workspaceId] = await Promise.all([listWorkspaces(), activeWorkspaceId()]);
  // Accounts that need attention: dead tokens, or LinkedIn tokens about to expire (no refresh).
  // Reason: across workspaces, so a dead token at another company isn't missed.
  const attention = await db
    .select({
      name: schema.socialAccounts.name,
      network: schema.socialAccounts.network,
      workspace: schema.workspaces.name,
    })
    .from(schema.socialAccounts)
    .innerJoin(schema.workspaces, eq(schema.workspaces.workspaceId, schema.socialAccounts.workspaceId))
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
      {/* The page's hero continues this dark band below the header. */}
      <header className="border-b border-chrome-line bg-chrome text-white">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-center gap-3 py-3">
            <Link
              href="/calendar"
              className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-white hover:no-underline"
            >
              <Logo className="size-8" />
              Posty
            </Link>
            {workspaces.length > 1 && <WorkspaceSwitcher workspaces={workspaces} current={workspaceId} />}
            <div className="ml-auto flex items-center gap-2">
              <Link href="/compose" className="btn-primary">
                <Plus className="size-4" />
                New post
              </Link>
              <form action={logout}>
                <button
                  className="inline-flex size-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/5 text-chrome-muted hover:bg-white/10 hover:text-white"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="size-4" />
                </button>
              </form>
            </div>
          </div>
          <Nav />
          {attention.length > 0 && (
            <p className="mb-3 flex items-start gap-2 rounded-xl bg-warn/15 px-3 py-2 text-sm text-warn">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                {attention
                  .map((a) => {
                    const label = NETWORKS[a.network as NetworkId]?.label ?? a.network;
                    return `${a.name} (${label}${workspaces.length > 1 ? `, ${a.workspace}` : ""})`;
                  })
                  .join(", ")}{" "}
                {attention.length === 1 ? "needs" : "need"} to be reconnected.{" "}
                <Link href="/accounts" className="font-semibold text-white underline">
                  Go to Accounts
                </Link>
              </span>
            </p>
          )}
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
