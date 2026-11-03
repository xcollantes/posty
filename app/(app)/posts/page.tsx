import Link from "next/link";
import { and, asc, desc, eq, exists, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { NETWORKS, type NetworkId } from "@/lib/networks/catalog";
import { PostActions } from "./PostActions";

const TABS = {
  scheduled: { label: "Scheduled", statuses: ["scheduled"] },
  drafts: { label: "Drafts", statuses: ["draft"] },
  published: { label: "Published", statuses: ["published", "partial"] },
  failed: { label: "Failed", statuses: ["failed", "partial"] },
} as const;
type Tab = keyof typeof TABS;

const STATUS_STYLE: Record<string, string> = {
  pending: "text-muted",
  publishing: "text-sky-600",
  published: "text-green-600",
  failed: "text-red-600",
};

export default async function PostsPage({ searchParams }: PageProps<"/posts">) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab: Tab = (sp.status as Tab) in TABS ? (sp.status as Tab) : "scheduled";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const accountFilter = typeof sp.account === "string" ? sp.account : "";
  const tagFilter = typeof sp.tag === "string" ? sp.tag : "";

  const filters: (SQL | undefined)[] = [inArray(schema.posts.status, [...TABS[tab].statuses])];
  if (q) filters.push(ilike(sql`${schema.posts.content}::text`, `%${q}%`));
  if (accountFilter) {
    filters.push(
      exists(
        db.select().from(schema.postTargets).where(
          and(eq(schema.postTargets.postId, schema.posts.postId), eq(schema.postTargets.socialAccountId, accountFilter)),
        ),
      ),
    );
  }
  if (tagFilter) {
    filters.push(
      exists(
        db.select().from(schema.postTags).where(and(eq(schema.postTags.postId, schema.posts.postId), eq(schema.postTags.tagId, tagFilter))),
      ),
    );
  }

  const [posts, accounts, tags] = await Promise.all([
    db
      .select()
      .from(schema.posts)
      .where(and(...filters))
      .orderBy(tab === "scheduled" ? asc(schema.posts.scheduledAt) : desc(schema.posts.updatedAt))
      .limit(100),
    db.select().from(schema.socialAccounts).orderBy(asc(schema.socialAccounts.name)),
    db.select().from(schema.tags).orderBy(asc(schema.tags.name)),
  ]);
  const ids = posts.map((p) => p.postId);
  const [targets, postTags] = ids.length
    ? await Promise.all([
        db.select().from(schema.postTargets).where(inArray(schema.postTargets.postId, ids)),
        db.select().from(schema.postTags).where(inArray(schema.postTags.postId, ids)),
      ])
    : [[], []];
  const accountById = new Map(accounts.map((a) => [a.socialAccountId, a]));
  const tagById = new Map(tags.map((t) => [t.tagId, t]));
  const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: user.timezone });

  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ status: tab, ...(q && { q }), ...(accountFilter && { account: accountFilter }), ...(tagFilter && { tag: tagFilter }), ...patch });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    return `/posts?${p}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Posts</h1>
        <Link href="/compose" className="btn-primary">New post</Link>
      </div>
      <nav className="flex gap-1 border-b border-border text-sm">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link key={t} href={href({ status: t })} className={`-mb-px border-b-2 px-3 py-1.5 ${t === tab ? "border-accent font-medium" : "border-transparent text-muted"}`}>
            {TABS[t].label}
          </Link>
        ))}
      </nav>
      <form className="flex flex-wrap gap-2" action="/posts">
        <input type="hidden" name="status" value={tab} />
        <input name="q" defaultValue={q} placeholder="Search text…" className="input max-w-xs" />
        <select name="account" defaultValue={accountFilter} className="input max-w-[12rem]">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.socialAccountId} value={a.socialAccountId}>{a.name} ({a.network})</option>
          ))}
        </select>
        <select name="tag" defaultValue={tagFilter} className="input max-w-[10rem]">
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.tagId} value={t.tagId}>{t.name}</option>
          ))}
        </select>
        <button className="btn">Filter</button>
      </form>

      {posts.length === 0 && <p className="text-sm text-muted">Nothing here yet.</p>}
      <ul className="space-y-3">
        {posts.map((post) => {
          const ts = targets.filter((t) => t.postId === post.postId);
          const first = post.content.parts[0];
          return (
            <li key={post.postId} className="card space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm text-muted">
                  {post.scheduledAt ? fmt.format(post.scheduledAt) : "No date"}
                  {post.content.parts.length > 1 && ` · thread of ${post.content.parts.length}`}
                  {first?.mediaIds.length ? ` · ${first.mediaIds.length} media` : ""}
                  {postTags
                    .filter((pt) => pt.postId === post.postId)
                    .map((pt) => tagById.get(pt.tagId))
                    .filter(Boolean)
                    .map((t) => (
                      <span key={t!.tagId} className="ml-2 rounded-full px-2 py-0.5 text-xs text-white" style={{ background: t!.color }}>
                        {t!.name}
                      </span>
                    ))}
                </div>
                <PostActions postId={post.postId} status={post.status} />
              </div>
              <Link href={`/compose/${post.postId}`} className="block whitespace-pre-wrap break-words text-sm hover:underline">
                {first?.text.slice(0, 400) || <span className="text-muted">(media only)</span>}
              </Link>
              {ts.length > 0 && (
                <ul className="space-y-1 border-t border-border pt-2 text-xs">
                  {ts.map((t) => {
                    const a = accountById.get(t.socialAccountId);
                    const info = a ? NETWORKS[a.network as NetworkId] : null;
                    return (
                      <li key={t.postTargetId} className="flex flex-wrap items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: info?.color }} />
                        <span className="font-medium">{a?.name ?? "deleted account"}</span>
                        <span className="text-muted">{info?.label}</span>
                        <span className={STATUS_STYLE[t.status]}>{t.status}</span>
                        {t.url && (
                          <a href={t.url} target="_blank" rel="noreferrer" className="text-accent underline">view</a>
                        )}
                        {t.error && <span className="w-full text-red-600">{t.error}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
