import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type MetricsFilter = {
  /** By the post's workspace, so history stays put when an account moves. */
  workspaceId?: string;
  from?: Date;
  to?: Date;
  accountIds?: string[];
  tagIds?: string[];
  postIds?: string[];
  limit?: number;
};

/** Published targets, newest first, each with its latest metrics snapshot. */
export async function publishedWithMetrics(filter: MetricsFilter = {}) {
  const latest = db
    .selectDistinctOn([schema.postMetrics.postTargetId])
    .from(schema.postMetrics)
    .orderBy(schema.postMetrics.postTargetId, desc(schema.postMetrics.fetchedAt))
    .as("latest");
  const query = db
    .select({
      postTargetId: schema.postTargets.postTargetId,
      postId: schema.postTargets.postId,
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
      fetchedAt: latest.fetchedAt,
    })
    .from(schema.postTargets)
    .innerJoin(schema.posts, eq(schema.posts.postId, schema.postTargets.postId))
    .innerJoin(schema.socialAccounts, eq(schema.socialAccounts.socialAccountId, schema.postTargets.socialAccountId))
    .leftJoin(latest, eq(latest.postTargetId, schema.postTargets.postTargetId))
    .where(
      and(
        eq(schema.postTargets.status, "published"),
        filter.workspaceId ? eq(schema.posts.workspaceId, filter.workspaceId) : undefined,
        filter.from && gte(schema.postTargets.publishedAt, filter.from),
        filter.to && lte(schema.postTargets.publishedAt, filter.to),
        filter.accountIds && inArray(schema.postTargets.socialAccountId, filter.accountIds),
        filter.postIds && inArray(schema.postTargets.postId, filter.postIds),
        filter.tagIds &&
          inArray(
            schema.postTargets.postId,
            db.select({ postId: schema.postTags.postId }).from(schema.postTags).where(inArray(schema.postTags.tagId, filter.tagIds)),
          ),
      ),
    )
    .orderBy(desc(schema.postTargets.publishedAt))
    .$dynamic();
  return filter.limit ? query.limit(filter.limit) : query;
}

// null = the network never reported this number (shown as a dash, not 0).
export type Totals = {
  posts: number;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
};

const add = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b);
const EMPTY: Totals = { posts: 0, views: null, likes: null, comments: null, shares: null, clicks: null };

export function totalsByNetwork(rows: Awaited<ReturnType<typeof publishedWithMetrics>>): Map<string, Totals> {
  const totals = new Map<string, Totals>();
  for (const r of rows) {
    const t = totals.get(r.network) ?? { ...EMPTY };
    t.posts++;
    t.views = add(t.views, r.views);
    t.likes = add(t.likes, r.likes);
    t.comments = add(t.comments, r.comments);
    t.shares = add(t.shares, r.shares);
    t.clicks = add(t.clicks, r.clicks);
    totals.set(r.network, t);
  }
  return totals;
}

export const sumTotals = (totals: Iterable<Totals>): Totals =>
  [...totals].reduce<Totals>(
    (s, t) => ({
      posts: s.posts + t.posts,
      views: add(s.views, t.views),
      likes: add(s.likes, t.likes),
      comments: add(s.comments, t.comments),
      shares: add(s.shares, t.shares),
      clicks: add(s.clicks, t.clicks),
    }),
    EMPTY,
  );
