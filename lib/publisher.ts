import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { markReconnect, toAccount, withFreshToken } from "@/lib/accounts";
import { db, schema } from "@/lib/db";
import { loadMedia } from "@/lib/media";
import { getNetwork } from "@/lib/networks";
import { NetworkError } from "@/lib/networks/http";
import type { PublishResult } from "@/lib/networks/types";

const MAX_ATTEMPTS = 3;
const STUCK_MINUTES = 15;
// Posts overdue by more than this (worker was down) are failed, not sent late.
const MISSED_MINUTES = 60;

export const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

/** Atomically claim due targets. SKIP LOCKED lets several workers share the table. */
export async function claimDue(limit = 5): Promise<string[]> {
  const rows = await db.execute<{ post_target_id: string }>(sql`
    update post_targets set status = 'publishing', locked_at = now()
    where post_target_id in (
      select t.post_target_id from post_targets t
      join posts p on p.post_id = t.post_id
      where p.status = 'scheduled' and t.status = 'pending'
        and p.scheduled_at <= now()
        and (t.next_attempt_at is null or t.next_attempt_at <= now())
      order by p.scheduled_at
      limit ${limit}
      for update of t skip locked
    )
    returning post_target_id`);
  return rows.map((r) => r.post_target_id);
}

/** Recompute a post's status from its targets once none are in flight. */
export async function rollupPost(postId: string) {
  const targets = await db
    .select({ status: schema.postTargets.status })
    .from(schema.postTargets)
    .where(eq(schema.postTargets.postId, postId));
  if (!targets.length || targets.some((t) => t.status === "pending" || t.status === "publishing")) return;
  const ok = targets.filter((t) => t.status === "published").length;
  const status = ok === targets.length ? "published" : ok === 0 ? "failed" : "partial";
  await db.update(schema.posts).set({ status, updatedAt: new Date() }).where(eq(schema.posts.postId, postId));
}

async function notify(text: string) {
  const hook = process.env.NOTIFY_WEBHOOK_URL;
  if (!hook) return;
  // Slack uses `text`, Discord uses `content`; sending both covers both.
  await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => log(`notify failed: ${e}`));
}

/** Publish one claimed target. Never throws. */
export async function publishTarget(postTargetId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.postTargets)
    .innerJoin(schema.posts, eq(schema.posts.postId, schema.postTargets.postId))
    .innerJoin(schema.socialAccounts, eq(schema.socialAccounts.socialAccountId, schema.postTargets.socialAccountId))
    .where(eq(schema.postTargets.postTargetId, postTargetId));
  if (!row) return;
  const target = row.post_targets;
  const account = row.social_accounts;
  const network = getNetwork(account.network);
  const content = target.contentOverride ?? row.posts.content;
  const options = target.options;
  // Networks without threads only get the first part.
  const parts = network.info.threads ? content.parts : content.parts.slice(0, 1);
  const label = `${network.info.label} ${account.name} (target ${postTargetId.slice(0, 8)})`;

  let first: PublishResult | null = null;
  let last: PublishResult | null = null;
  try {
    if (!account.isActive) throw new NetworkError("Account is disabled");
    const acct = await withFreshToken(account.socialAccountId);
    for (const [i, part] of parts.entries()) {
      const result: PublishResult = await network.publish(
        acct,
        { text: part.text, media: await loadMedia(part.mediaIds) },
        {
          idempotencyKey: `${postTargetId}-${i}`,
          options,
          replyTo: first && last ? { root: first, parent: last } : undefined,
          log: (m) => log(`${label}: ${m}`),
        },
      );
      if (!first) {
        first = result;
        // Record the live post right away so a crash later can't hide it.
        await db
          .update(schema.postTargets)
          .set({ providerPostId: result.id, url: result.url })
          .where(eq(schema.postTargets.postTargetId, postTargetId));
      }
      last = result;
    }

    let note: string | null = null;
    const comment = options.firstComment?.trim();
    if (comment && first && last) {
      try {
        if (network.firstComment) await network.firstComment(acct, first, comment);
        else if (network.info.threads) {
          await network.publish(acct, { text: comment, media: [] }, {
            idempotencyKey: `${postTargetId}-comment`,
            options: {},
            replyTo: { root: first, parent: last },
            log: (m) => log(`${label}: ${m}`),
          });
        }
      } catch (err) {
        note = `Published, but the first comment failed: ${(err as Error).message}`;
      }
    }
    await db
      .update(schema.postTargets)
      .set({ status: "published", publishedAt: new Date(), error: note, lockedAt: null })
      .where(eq(schema.postTargets.postTargetId, postTargetId));
    log(`${label}: published ${first?.url ?? ""}`);
  } catch (err) {
    const e = err instanceof NetworkError ? err : new NetworkError((err as Error).message);
    const attempts = target.attemptCount + 1;
    // Only retry when nothing went live: a half-posted thread is never re-run.
    const retry = e.retryable && !first && attempts < MAX_ATTEMPTS;
    if (e.reconnect) await markReconnect(account.socialAccountId);
    await db
      .update(schema.postTargets)
      .set({
        status: retry ? "pending" : "failed",
        attemptCount: attempts,
        nextAttemptAt: retry ? new Date(Date.now() + 2 ** attempts * 60_000) : null,
        error: first ? `Partly published (${first.url}), then failed: ${e.message}` : e.message,
        lockedAt: null,
      })
      .where(eq(schema.postTargets.postTargetId, postTargetId));
    log(`${label}: ${retry ? "will retry" : "failed"}: ${e.message}`);
    if (!retry) await notify(`Posty: post to ${network.info.label} (${account.name}) failed: ${e.message}`);
  }
  await rollupPost(target.postId);
}

/** Targets stuck in `publishing` (worker crashed) fail instead of re-posting. */
export async function failStuck() {
  const rows = await db.execute<{ post_id: string }>(sql`
    update post_targets set status = 'failed', locked_at = null,
      error = 'Interrupted while publishing. Check the network before retrying.'
    where status = 'publishing' and locked_at < now() - make_interval(mins => ${STUCK_MINUTES})
    returning post_id`);
  for (const r of new Set(rows.map((r) => r.post_id))) await rollupPost(r);
}

/**
 * Never-attempted targets whose slot passed while the worker was down fail
 * instead of posting late. A post saved with a past time (e.g. re-scheduling
 * a missed post without changing its time) has a recent updated_at, so it
 * still goes out right away.
 */
export async function failMissed() {
  const rows = await db.execute<{ post_id: string }>(sql`
    update post_targets t set status = 'failed',
      error = 'Missed its scheduled time while the worker was down. Use Retry, or edit the post to pick a new time.'
    from posts p
    where p.post_id = t.post_id and p.status = 'scheduled' and t.status = 'pending'
      and t.next_attempt_at is null
      and greatest(p.scheduled_at, p.updated_at) < now() - make_interval(mins => ${MISSED_MINUTES})
    returning t.post_id`);
  const postIds = new Set(rows.map((r) => r.post_id));
  for (const id of postIds) await rollupPost(id);
  if (postIds.size) await notify(`Posty: ${postIds.size} scheduled post(s) missed their time while the worker was down`);
}

const DAY = 86_400_000;

/**
 * Keep long-lived tokens alive without waiting for a post:
 * Threads extends before day 60, Pinterest before day 30, and rotating
 * refresh tokens (X, TikTok) are exercised monthly.
 */
export async function refreshSweep() {
  const rows = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.isActive, true));
  for (const row of rows) {
    const network = getNetwork(row.network);
    if (!network.refresh || row.needsReconnect) continue;
    const acct = toAccount(row);
    const now = Date.now();
    const due = network.shouldRefresh
      ? network.shouldRefresh(acct)
      : (acct.expiresAt !== null &&
          acct.expiresAt.getTime() - acct.tokenIssuedAt.getTime() > 2 * DAY &&
          acct.expiresAt.getTime() - now < 7 * DAY) ||
        now - acct.tokenIssuedAt.getTime() > 30 * DAY;
    if (!due) continue;
    await withFreshToken(row.socialAccountId, true).then(
      () => log(`refreshed token for ${network.info.label} ${row.name}`),
      (e) => log(`token refresh failed for ${network.info.label} ${row.name}: ${(e as Error).message}`),
    );
  }
}

/** Daily metrics for posts published in the last 30 days. X reads are billed, so opt-in. */
export async function metricsSweep() {
  const since = new Date(Date.now() - 30 * DAY);
  const rows = await db
    .select()
    .from(schema.postTargets)
    .innerJoin(schema.socialAccounts, eq(schema.socialAccounts.socialAccountId, schema.postTargets.socialAccountId))
    .where(
      and(
        eq(schema.postTargets.status, "published"),
        isNotNull(schema.postTargets.providerPostId),
        gte(schema.postTargets.publishedAt, since),
      ),
    );
  for (const { post_targets: t, social_accounts: a } of rows) {
    const network = getNetwork(a.network);
    if (!network.metrics || a.needsReconnect) continue;
    if (a.network === "x" && process.env.X_METRICS !== "1") continue;
    try {
      const acct = await withFreshToken(a.socialAccountId);
      const m = await network.metrics(acct, t.providerPostId!);
      await db.insert(schema.postMetrics).values({ postTargetId: t.postTargetId, ...m });
    } catch (e) {
      log(`metrics failed for ${network.info.label} ${t.postTargetId}: ${(e as Error).message}`);
    }
  }
}
