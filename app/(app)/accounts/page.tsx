import { asc } from "drizzle-orm";
import { Avatar } from "@/components/composer/Preview";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { networks } from "@/lib/networks";
import { NETWORK_IDS, NETWORKS, type NetworkId } from "@/lib/networks/catalog";
import { redirectUriFor } from "@/lib/oauth";
import { daysFromNow } from "@/lib/time";
import { AccountRowActions, FormConnect, OAuthPreForm } from "./AccountForms";

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
  const { error, connected } = await searchParams;
  const accounts = await db
    .select()
    .from(schema.socialAccounts)
    .orderBy(asc(schema.socialAccounts.network), asc(schema.socialAccounts.name));
  const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: user.timezone });
  const soon = daysFromNow(10);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Accounts</h1>
      {typeof error === "string" && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {typeof connected === "string" && (
        <p className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          Connected {connected} account{connected === "1" ? "" : "s"}.
        </p>
      )}

      <section className="space-y-2">
        <h2 className="label">Connected</h2>
        {accounts.length === 0 && <p className="text-sm text-muted">Nothing connected yet.</p>}
        <ul className="divide-y divide-border rounded-lg border border-border bg-panel">
          {accounts.map((a) => {
            const info = NETWORKS[a.network as NetworkId];
            const expiring = !networks[a.network as NetworkId].refresh && a.expiresAt && a.expiresAt < soon;
            return (
              <li key={a.socialAccountId} className="flex flex-wrap items-center gap-3 p-3">
                <Avatar account={{ avatar: a.avatar, name: a.name, network: a.network as NetworkId }} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">
                    {a.name} <span className="font-normal text-muted">· {info.label}{a.username ? ` · ${a.username}` : ""}</span>
                  </div>
                  <div className="text-xs">
                    {a.needsReconnect ? (
                      <span className="text-red-600">Needs reconnecting</span>
                    ) : expiring ? (
                      <span className="text-amber-600">Access expires {fmt.format(a.expiresAt!)}: reconnect before then</span>
                    ) : !a.isActive ? (
                      <span className="text-muted">Paused</span>
                    ) : (
                      <span className="text-green-600">Active</span>
                    )}
                  </div>
                </div>
                <AccountRowActions
                  socialAccountId={a.socialAccountId}
                  isActive={a.isActive}
                  reconnectHref={info.connectKind === "oauth" && a.network !== "mastodon" ? `/api/connect/${a.network}/start` : null}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="label">Connect a network</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {NETWORK_IDS.map((id) => {
            const info = NETWORKS[id];
            const connect = networks[id].connect;
            const ok = configured(id);
            return (
              <div key={id} className="card space-y-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: info.color }} />
                  <h3 className="font-medium">{info.label}</h3>
                </div>
                {info.warning && <p className="text-xs text-muted">{info.warning}</p>}
                {!ok ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Set <code>{ENV_PREFIX[id]}_CLIENT_ID</code> and <code>{ENV_PREFIX[id]}_CLIENT_SECRET</code> in <code>.env</code>. See docs/networks.md.
                  </p>
                ) : connect.kind === "form" ? (
                  <FormConnect network={id} fields={connect.fields} />
                ) : connect.preFields ? (
                  <OAuthPreForm network={id} fields={connect.preFields} />
                ) : (
                  <a href={`/api/connect/${id}/start`} className="btn-primary">Connect {info.label}</a>
                )}
                {connect.kind === "oauth" && (
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer">Redirect URI</summary>
                    <code className="break-all">{redirectUriFor(id)}</code>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
