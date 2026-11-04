import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { Avatar } from "@/components/composer/Preview";
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
  const { error, connected } = await searchParams;
  const accounts = await db
    .select()
    .from(schema.socialAccounts)
    .orderBy(asc(schema.socialAccounts.network), asc(schema.socialAccounts.name));
  const fmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: user.timezone });
  const soon = daysFromNow(10);

  return (
    <div className="max-w-4xl">
      <h1>Accounts</h1>
      {typeof error === "string" && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {typeof connected === "string" && (
        <p className="mt-3 text-sm text-ok">
          Connected {connected} account{connected === "1" ? "" : "s"}.
        </p>
      )}

      <h2 className="mt-6">Connected</h2>
      {accounts.length === 0 ? (
        <p className="hint mt-1">None yet. Add one below.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table mt-2 min-w-[600px]">
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
                      <div className="flex items-center gap-2">
                        <Avatar account={{ avatar: a.avatar, name: a.name }} size={24} />
                        <div className="leading-tight">
                          <div>{a.name}</div>
                          {a.username && <div className="text-xs text-muted">{a.username}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{info.label}</td>
                    <td>
                      {a.needsReconnect ? (
                        <span className="text-danger">Reconnect needed</span>
                      ) : expiring ? (
                        <span className="text-danger">Expires {fmt.format(a.expiresAt!)}</span>
                      ) : !a.isActive ? (
                        <span className="text-muted">Paused</span>
                      ) : (
                        "Active"
                      )}
                    </td>
                    <td>
                      <AccountRowActions
                        socialAccountId={a.socialAccountId}
                        isActive={a.isActive}
                        reconnectHref={
                          info.connectKind === "oauth" && a.network !== "mastodon" ? `/api/connect/${a.network}/start` : null
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

      <h2 className="mt-10">Add an account</h2>
      <p className="hint">
        Most networks need a developer app first; docs/networks.md has the steps. Bluesky and Mastodon don&apos;t.
      </p>
      <table className="data-table mt-2">
        <tbody>
          {NETWORK_IDS.map((id) => {
            const info = NETWORKS[id];
            const connect = networks[id].connect;
            return (
              <tr key={id}>
                <td className="w-32 font-medium">{info.label}</td>
                <td>
                  {!configured(id) ? (
                    <p className="text-muted">
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
                  {info.warning && <p className="hint mt-1">{info.warning}</p>}
                  {connect.kind === "oauth" && (
                    <details className="mt-1 text-xs text-muted">
                      <summary className="cursor-pointer">Redirect URI</summary>
                      <code className="break-all">{redirectUriFor(id)}</code>
                    </details>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
