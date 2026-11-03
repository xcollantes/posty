import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, count, desc, eq, exists, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { NETWORKS, type NetworkId } from "@/lib/networks/catalog";
import { PostActions } from "./PostActions";

export const metadata: Metadata = { title: "Posts" };

const TABS = {
  scheduled: { label: "Scheduled", statuses: ["scheduled"], empty: "Nothing scheduled." },
  drafts: { label: "Drafts", statuses: ["draft"], empty: "No drafts." },
  published: { label: "Published", statuses: ["published", "partial"], empty: "Nothing published yet." },
  failed: { label: "Failed", statuses: ["failed", "partial"], empty: "No failed posts." },
} as const;
type Tab = keyof typeof TABS;

const CELL = "max-sm:block max-sm:border-0 max-sm:py-0.5 max-sm:pr-0";

// Pending targets show nothing: the post's date already says when.
const TARGET_STATUS: Record<string, { label: string; className: string }> = {
  publishing: { label: "posting now", className: "text-link" },
  published: { label: "posted", className: "text-ok" },
  failed: { label: "failed", className: "text-danger" },
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
        db
          .select()
          .from(schema.postTargets)
          .where(
            and(eq(schema.postTargets.postId, schema.posts.postId), eq(schema.postTargets.socialAccountId, accountFilter)),
          ),
      ),
    );
  }
  if (tagFilter) {
    filters.push(
      exists(
        db
          .select()
          .from(schema.postTags)
          .where(and(eq(schema.postTags.postId, schema.posts.postId), eq(schema.postTags.tagId, tagFilter))),
      ),
    );
  }

  const [posts, accounts, tags, counts] = await Promise.all([
    db
      .select()
      .from(schema.posts)
      .where(and(...filters))
      .orderBy(tab === "scheduled" ? asc(schema.posts.scheduledAt) : desc(schema.posts.updatedAt))
      .limit(100),
    db.select().from(schema.socialAccounts).orderBy(asc(schema.socialAccounts.name)),
    db.select().from(schema.tags).orderBy(asc(schema.tags.name)),
    db.select({ status: schema.posts.status, n: count() }).from(schema.posts).groupBy(schema.posts.status),
  ]);
  const ids = posts.map((p) => p.postId);
  const mediaIds = posts.flatMap((p) => p.content.parts.flatMap((part) => part.mediaIds));
  const [targets, postTags, mediaKinds] = ids.length
    ? await Promise.all([
        db.select().from(schema.postTargets).where(inArray(schema.postTargets.postId, ids)),
        db.select().from(schema.postTags).where(inArray(schema.postTags.postId, ids)),
        mediaIds.length
          ? db
              .select({ mediaId: schema.media.mediaId, mime: schema.media.mime })
              .from(schema.media)
              .where(inArray(schema.media.mediaId, mediaIds))
          : [],
      ])
    : [[], [], []];
  const isVideo = new Map(mediaKinds.map((m) => [m.mediaId, m.mime.startsWith("video/")]));
  const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);
  const accountById = new Map(accounts.map((a) => [a.socialAccountId, a]));
  const tagById = new Map(tags.map((t) => [t.tagId, t]));
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const tabCount = (t: Tab) => TABS[t].statuses.reduce((n, s) => n + (byStatus[s] ?? 0), 0);
  const fmt = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: user.timezone,
  });
  const filtered = Boolean(q || accountFilter || tagFilter);

  return (
    <div>
      <h1>Posts</h1>

      <nav className="mt-4 flex flex-wrap gap-x-6 border-b border-line text-sm">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link
            key={t}
            href={`/posts?status=${t}`}
            className={`-mb-px border-b-2 pb-2 hover:no-underline ${
              t === tab ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {TABS[t].label} <span className="font-normal text-muted">{tabCount(t)}</span>
          </Link>
        ))}
      </nav>

      <form className="mt-4 flex flex-wrap items-center gap-2" action="/posts">
        <input type="hidden" name="status" value={tab} />
        <input name="q" defaultValue={q} placeholder="Search" aria-label="Search post text" className="input w-52" />
        <select name="account" defaultValue={accountFilter} aria-label="Account" className="input w-auto">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.socialAccountId} value={a.socialAccountId}>
              {a.name} ({NETWORKS[a.network as NetworkId]?.label ?? a.network})
            </option>
          ))}
        </select>
        {tags.length > 0 && (
          <select name="tag" defaultValue={tagFilter} aria-label="Tag" className="input w-auto">
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.tagId} value={t.tagId}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn">Filter</button>
        {filtered && (
          <Link href={`/posts?status=${tab}`} className="text-sm">
            Clear
          </Link>
        )}
      </form>

      {posts.length === 0 ? (
        <p className="mt-6 text-muted">
          {filtered ? "No posts match." : TABS[tab].empty}{" "}
          {tab === "scheduled" && !filtered && <Link href="/compose">Write a post</Link>}
        </p>
      ) : (
        <div className="mt-4">
          {/* On phones each row stacks into a block instead of scrolling sideways. */}
          <table className="data-table max-sm:block">
            <thead className="max-sm:hidden">
              <tr>
                <th className="w-36">{tab === "scheduled" ? "When" : "Date"}</th>
                <th>Post</th>
                <th className="w-72">Accounts</th>
                <th className="w-1">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="max-sm:block">
              {posts.map((post) => {
                const ts = targets.filter((t) => t.postId === post.postId);
                const first = post.content.parts[0];
                const attached = post.content.parts.flatMap((p) => p.mediaIds);
                const videos = attached.filter((id) => isVideo.get(id)).length;
                const images = attached.length - videos;
                const mediaLabel = [images && plural(images, "image"), videos && plural(videos, "video")]
                  .filter(Boolean)
                  .join(", ");
                const postTagList = postTags
                  .filter((pt) => pt.postId === post.postId)
                  .map((pt) => tagById.get(pt.tagId))
                  .filter((t) => t !== undefined);
                return (
                  <tr key={post.postId} className="max-sm:block max-sm:border-b max-sm:border-line max-sm:py-2">
                    <td className={`whitespace-nowrap max-sm:text-muted ${CELL}`}>
                      {post.scheduledAt ? fmt.format(post.scheduledAt) : <span className="text-muted">No date</span>}
                    </td>
                    <td className={CELL}>
                      <Link href={`/compose/${post.postId}`} className="line-clamp-2 text-fg">
                        {first?.text || <span className="text-muted">(media only)</span>}
                      </Link>
                      {(post.content.parts.length > 1 || mediaLabel || postTagList.length > 0) && (
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                          {post.content.parts.length > 1 && <span>Thread of {post.content.parts.length}</span>}
                          {mediaLabel && <span>{mediaLabel}</span>}
                          {postTagList.map((t) => (
                            <span key={t.tagId} className="inline-flex items-center gap-1">
                              <span className="inline-block size-2 rounded-[1px]" style={{ background: t.color }} />
                              {t.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={CELL}>
                      <ul className="space-y-1">
                        {ts.map((t) => {
                          const a = accountById.get(t.socialAccountId);
                          const status = TARGET_STATUS[t.status];
                          return (
                            <li key={t.postTargetId}>
                              {NETWORKS[a?.network as NetworkId]?.label ?? "Deleted account"}{" "}
                              <span className="text-muted">{a?.name}</span>
                              {status && <span className={`ml-1.5 ${status.className}`}>{status.label}</span>}
                              {t.url && (
                                <a href={t.url} target="_blank" rel="noreferrer" className="ml-1.5">
                                  view
                                </a>
                              )}
                              {t.error && (
                                <p className="line-clamp-2 break-words text-xs text-danger" title={t.error}>
                                  {t.error}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                    <td className={CELL}>
                      <PostActions postId={post.postId} status={post.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
