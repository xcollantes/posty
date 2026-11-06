import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { Avatar } from "@/components/composer/Preview";
import { Card, Page } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { networks } from "@/lib/networks";
import { NETWORK_IDS, NETWORKS, type NetworkId } from "@/lib/networks/catalog";
import { redirectUriFor } from "@/lib/oauth";
import { daysFromNow } from "@/lib/time";
import { AccountRowActions, FormConnect, OAuthPreForm } from "./AccountForms";

export const metadata: Metadata = { title: "Accounts" };

const ENV_PREFIX: Partial<Record<NetworkId, string>> = {
  facebook: "FACEBOOK",
  instagram: "INSTAGRAM",
  threads: "THREADS",
  x: "X",
  linkedin: "LINKEDIN",
  pinterest: "PINTEREST",
  youtube: "YOUTUBE",
  tiktok: "TIKTOK",
};

const configured = (id: NetworkId) => {
  const p = ENV_PREFIX[id];
  return !p || Boolean(process.env[`${p}_CLIENT_ID`] && process.env[`${p}_CLIENT_SECRET`]);
};

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const user = await requireUser();
  const { error, connected, network } = await searchParams;
  const accounts = await db
    .select()
    .from(schema.socialAccounts)
    .orderBy(asc(schema.socialAccounts.network), asc(schema.socialAccounts.name));
  const fmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: user.timezone });
  const soon = daysFromNow(10);

  return (
    <Page title="Accounts" description="The social accounts Posty posts to.">
      <div className="space-y-6">
        {/* Opaque cards, not tinted ones: they can sit on the dark hero. */}
        {typeof error === "string" && (
          <p role="alert" className="card flex items-center gap-2 px-5 py-3 text-sm font-semibold text-danger">
            <CircleAlert className="size-4 shrink-0" />
            {error}
          </p>
        )}
        {connected === "0" ? (
          <p className="card flex items-center gap-2 px-5 py-3 text-sm font-semibold">
            <Info className="size-4 shrink-0" />
            Refreshed the {network} account you already had. To add a different one, switch accounts (or sign out) on{" "}
            {network} in this browser, then Connect again.
          </p>
        ) : (
          typeof connected === "string" && (
            <p className="card flex items-center gap-2 px-5 py-3 text-sm font-semibold text-ok">
              <CircleCheck className="size-4 shrink-0" />
              Connected {connected} new account{connected === "1" ? "" : "s"}.
            </p>
          )
        )}

        <Card title="Connected accounts" flush className="overflow-hidden">
          {accounts.length === 0 ? (
            <p className="hint p-5">None yet. Add one below.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[600px] [&_td]:align-middle">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Network</th>
                    <th>Status</th>
                    <th className="w-1">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => {
                    const info = NETWORKS[a.network as NetworkId];
                    const expiring = !networks[a.network as NetworkId].refresh && a.expiresAt && a.expiresAt < soon;
                    return (
                      <tr key={a.socialAccountId}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <Avatar account={{ avatar: a.avatar, name: a.name }} size={32} />
                            <div className="leading-tight">
                              <div className="font-semibold">{a.name}</div>
                              {a.username && <div className="text-xs text-muted">{a.username}</div>}
                            </div>
                          </div>
                        </td>
                        <td>{info.label}</td>
                        <td>
                          {a.needsReconnect ? (
                            <span className="chip bg-danger/12 text-danger">Reconnect needed</span>
                          ) : expiring ? (
                            <span className="chip bg-danger/12 text-danger">Expires {fmt.format(a.expiresAt!)}</span>
                          ) : !a.isActive ? (
                            <span className="chip bg-soft text-muted">Paused</span>
                          ) : (
                            <span className="chip bg-ok/12 text-ok">Active</span>
                          )}
                        </td>
                        <td>
                          <AccountRowActions
                            socialAccountId={a.socialAccountId}
                            isActive={a.isActive}
                            reconnectHref={
                              info.connectKind === "oauth" && a.network !== "mastodon"
                                ? `/api/connect/${a.network}/start`
                                : null
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Add an account"
          hint={
            <>
              Most networks need a developer app first; docs/networks.md has the steps. Bluesky and Mastodon don&apos;t.
              Connect again to add another account on the same network. X, LinkedIn, Pinterest and Threads use
              whichever account this browser is signed in to, so switch accounts there first.
            </>
          }
        >
          <ul className="grid gap-3 sm:grid-cols-2">
            {NETWORK_IDS.map((id) => {
              const info = NETWORKS[id];
              const connect = networks[id].connect;
              return (
                <li key={id} className="space-y-2 rounded-xl border border-line p-4">
                  <p className="font-semibold">{info.label}</p>
                  {!configured(id) ? (
                    <p className="text-sm text-muted">
                      Add <code>{ENV_PREFIX[id]}_CLIENT_ID</code> and <code>{ENV_PREFIX[id]}_CLIENT_SECRET</code> to
                      .env, then restart.
                    </p>
                  ) : connect.kind === "form" ? (
                    <FormConnect network={id} fields={connect.fields} />
                  ) : connect.preFields ? (
                    <OAuthPreForm network={id} fields={connect.preFields} />
                  ) : (
                    <a href={`/api/connect/${id}/start`} className="btn">
                      Connect
                    </a>
                  )}
                  {info.warning && <p className="hint">{info.warning}</p>}
                  {connect.kind === "oauth" && (
                    <details className="text-xs text-muted">
                      <summary className="cursor-pointer">Redirect URI</summary>
                      <code className="break-all">{redirectUriFor(id)}</code>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
