import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { ChartColumn } from "lucide-react";
import { Card, Page } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { NETWORKS, type NetworkId } from "@/lib/networks/catalog";

export const metadata: Metadata = { title: "Analytics" };

// null = the network never reported this number (shown as a dash, not 0).
type Totals = { posts: number; views: number | null; likes: number | null; comments: number | null; shares: number | null };
const add = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b);

export default async function AnalyticsPage() {
  const user = await requireUser();
  // Latest metrics snapshot per published target.
  const latest = db
    .selectDistinctOn([schema.postMetrics.postTargetId])
    .from(schema.postMetrics)
    .orderBy(schema.postMetrics.postTargetId, desc(schema.postMetrics.fetchedAt))
    .as("latest");
  const rows = await db
    .select({
      postTargetId: schema.postTargets.postTargetId,
      url: schema.postTargets.url,
      publishedAt: schema.postTargets.publishedAt,
      network: schema.socialAccounts.network,
      account: schema.socialAccounts.name,
      text: sql<string>`${schema.posts.content}->'parts'->0->>'text'`,
      views: latest.views,
      likes: latest.likes,
      comments: latest.comments,
      shares: latest.shares,
      clicks: latest.clicks,
    })
    .from(schema.postTargets)
    .innerJoin(schema.posts, eq(schema.posts.postId, schema.postTargets.postId))
    .innerJoin(schema.socialAccounts, eq(schema.socialAccounts.socialAccountId, schema.postTargets.socialAccountId))
    .leftJoin(latest, eq(latest.postTargetId, schema.postTargets.postTargetId))
    .where(eq(schema.postTargets.status, "published"))
    .orderBy(desc(schema.postTargets.publishedAt))
    .limit(200);

  const totals = new Map<string, Totals>();
  for (const r of rows) {
    const t = totals.get(r.network) ?? { posts: 0, views: null, likes: null, comments: null, shares: null };
    t.posts++;
    t.views = add(t.views, r.views);
    t.likes = add(t.likes, r.likes);
    t.comments = add(t.comments, r.comments);
    t.shares = add(t.shares, r.shares);
    totals.set(r.network, t);
  }
  // Across every network, for the stat cards.
  const all = [...totals.values()].reduce<Totals>(
    (s, t) => ({
      posts: s.posts + t.posts,
      views: add(s.views, t.views),
      likes: add(s.likes, t.likes),
      comments: add(s.comments, t.comments),
      shares: add(s.shares, t.shares),
    }),
    { posts: 0, views: null, likes: null, comments: null, shares: null },
  );
  const fmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: user.timezone });
  const num = (v: number | null) => (v === null ? <span className="text-muted">–</span> : v.toLocaleString("en"));
  const label = (network: string) => NETWORKS[network as NetworkId]?.label ?? network;
  const kpis = [
    ["Posts", all.posts],
    ["Views", all.views],
    ["Likes", all.likes],
    ["Comments", all.comments],
    ["Shares", all.shares],
  ] as const;

  return (
    <Page
      title="Analytics"
      description={
        <>
          Updated once a day for posts from the last 30 days. LinkedIn doesn&apos;t share numbers with personal apps,
          and X is off unless <code>X_METRICS=1</code> because X bills each read.
        </>
      }
    >
      {rows.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-link/10 text-link">
              <ChartColumn className="size-6" />
            </span>
            <p className="text-muted">Nothing published yet.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {kpis.map(([name, value]) => (
              <li key={name} className="card p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">{name}</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums">{num(value)}</p>
              </li>
            ))}
          </ul>

          <Card title="By network" flush className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Network</th>
                    <th className="text-right">Posts</th>
                    <th className="text-right">Views</th>
                    <th className="text-right">Likes</th>
                    <th className="text-right">Comments</th>
                    <th className="text-right">Shares</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[...totals].map(([network, t]) => (
                    <tr key={network}>
                      <td className="font-semibold">{label(network)}</td>
                      <td className="text-right">{t.posts}</td>
                      <td className="text-right">{num(t.views)}</td>
                      <td className="text-right">{num(t.likes)}</td>
                      <td className="text-right">{num(t.comments)}</td>
                      <td className="text-right">{num(t.shares)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="By post" flush className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th className="w-20">Date</th>
                    <th>Post</th>
                    <th className="w-44">Where</th>
                    <th className="text-right">Views</th>
                    <th className="text-right">Likes</th>
                    <th className="text-right">Comments</th>
                    <th className="text-right">Shares</th>
                    <th className="text-right">Clicks</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {rows.map((r) => (
                    <tr key={r.postTargetId}>
                      <td className="whitespace-nowrap">{r.publishedAt ? fmt.format(r.publishedAt) : ""}</td>
                      <td className="max-w-xs truncate">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer">
                            {r.text || "(media only)"}
                          </a>
                        ) : (
                          r.text
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {label(r.network)} <span className="text-muted">{r.account}</span>
                      </td>
                      <td className="text-right">{num(r.views)}</td>
                      <td className="text-right">{num(r.likes)}</td>
                      <td className="text-right">{num(r.comments)}</td>
                      <td className="text-right">{num(r.shares)}</td>
                      <td className="text-right">{num(r.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
