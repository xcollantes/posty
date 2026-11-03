import { desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { NETWORKS, type NetworkId } from "@/lib/networks/catalog";

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

  const totals = new Map<string, { posts: number; views: number; likes: number; comments: number; shares: number }>();
  for (const r of rows) {
    const t = totals.get(r.network) ?? { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 };
    t.posts++;
    t.views += r.views ?? 0;
    t.likes += r.likes ?? 0;
    t.comments += r.comments ?? 0;
    t.shares += r.shares ?? 0;
    totals.set(r.network, t);
  }
  const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: user.timezone });
  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted">
          Collected daily for posts from the last 30 days. LinkedIn personal accounts don&apos;t offer metrics; X metrics are
          off unless <code>X_METRICS=1</code> (reads are billed).
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[...totals].map(([network, t]) => (
          <div key={network} className="card">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: NETWORKS[network as NetworkId]?.color }} />
              {NETWORKS[network as NetworkId]?.label ?? network}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-2 text-xs">
              <dt className="text-muted">Posts</dt><dd className="text-right tabular-nums">{t.posts}</dd>
              <dt className="text-muted">Views</dt><dd className="text-right tabular-nums">{t.views.toLocaleString()}</dd>
              <dt className="text-muted">Likes</dt><dd className="text-right tabular-nums">{t.likes.toLocaleString()}</dd>
              <dt className="text-muted">Comments</dt><dd className="text-right tabular-nums">{t.comments.toLocaleString()}</dd>
              <dt className="text-muted">Shares</dt><dd className="text-right tabular-nums">{t.shares.toLocaleString()}</dd>
            </dl>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-panel">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr className="border-b border-border">
              <th className="p-2">Post</th>
              <th className="p-2">Network</th>
              <th className="p-2">Published</th>
              <th className="p-2 text-right">Views</th>
              <th className="p-2 text-right">Likes</th>
              <th className="p-2 text-right">Comments</th>
              <th className="p-2 text-right">Shares</th>
              <th className="p-2 text-right">Clicks</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-muted">No published posts yet.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.postTargetId} className="border-b border-border last:border-0">
                <td className="max-w-xs truncate p-2">
                  {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.text || "(media)"}</a> : r.text}
                </td>
                <td className="whitespace-nowrap p-2">{NETWORKS[r.network as NetworkId]?.label} · {r.account}</td>
                <td className="whitespace-nowrap p-2">{r.publishedAt ? fmt.format(r.publishedAt) : ""}</td>
                <td className="p-2 text-right tabular-nums">{n(r.views)}</td>
                <td className="p-2 text-right tabular-nums">{n(r.likes)}</td>
                <td className="p-2 text-right tabular-nums">{n(r.comments)}</td>
                <td className="p-2 text-right tabular-nums">{n(r.shares)}</td>
                <td className="p-2 text-right tabular-nums">{n(r.clicks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
