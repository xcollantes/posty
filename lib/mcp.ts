import { McpServer } from "@modelcontextprotocol/server";
import { asc, desc, eq, inArray } from "drizzle-orm";
import * as z from "zod";
import type { CurrentUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { savePostAs } from "@/lib/posts";

const STATUSES = {
  draft: ["draft"],
  scheduled: ["scheduled"],
  published: ["published", "partial"],
  failed: ["failed", "partial"],
} as const;

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/** One MCP server per request, acting as `user`. */
export function buildServer(user: CurrentUser): McpServer {
  const server = new McpServer(
    { name: "posty", version: "0.1.0" },
    {
      instructions:
        `Posty schedules social media posts. The user's timezone is ${user.timezone}. ` +
        "Call list_accounts first to get account IDs, then save_post. " +
        "Prefer mode=draft unless the user asked to schedule or queue.",
    },
  );

  server.registerTool(
    "list_accounts",
    {
      description: "List connected social accounts, the user's timezone and the current time.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const accounts = await db
        .select({
          accountId: schema.socialAccounts.socialAccountId,
          network: schema.socialAccounts.network,
          name: schema.socialAccounts.name,
          username: schema.socialAccounts.username,
          isActive: schema.socialAccounts.isActive,
          needsReconnect: schema.socialAccounts.needsReconnect,
        })
        .from(schema.socialAccounts)
        .orderBy(asc(schema.socialAccounts.network), asc(schema.socialAccounts.name));
      return json({ timezone: user.timezone, now: new Date().toISOString(), accounts });
    },
  );

  server.registerTool(
    "list_media",
    {
      description: "List files in the media library, newest first. Use a mediaId in save_post parts.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(30) }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const media = await db
        .select({
          mediaId: schema.media.mediaId,
          originalName: schema.media.originalName,
          mime: schema.media.mime,
          altText: schema.media.altText,
          createdAt: schema.media.createdAt,
        })
        .from(schema.media)
        .orderBy(desc(schema.media.createdAt))
        .limit(limit);
      return json(media);
    },
  );

  server.registerTool(
    "list_posts",
    {
      description: "List posts by status, with each target account's status, live URL and error.",
      inputSchema: z.object({
        status: z.enum(["draft", "scheduled", "published", "failed"]),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ status, limit }) => {
      const posts = await db
        .select()
        .from(schema.posts)
        .where(inArray(schema.posts.status, [...STATUSES[status]]))
        .orderBy(status === "scheduled" ? asc(schema.posts.scheduledAt) : desc(schema.posts.updatedAt))
        .limit(limit);
      const ids = posts.map((p) => p.postId);
      const targets = ids.length
        ? await db
            .select({
              postId: schema.postTargets.postId,
              accountId: schema.postTargets.socialAccountId,
              network: schema.socialAccounts.network,
              account: schema.socialAccounts.name,
              status: schema.postTargets.status,
              url: schema.postTargets.url,
              error: schema.postTargets.error,
            })
            .from(schema.postTargets)
            .innerJoin(
              schema.socialAccounts,
              eq(schema.socialAccounts.socialAccountId, schema.postTargets.socialAccountId),
            )
            .where(inArray(schema.postTargets.postId, ids))
        : [];
      return json(
        posts.map((p) => ({
          postId: p.postId,
          status: p.status,
          scheduledAt: p.scheduledAt?.toISOString() ?? null,
          parts: p.content.parts,
          targets: targets.filter((t) => t.postId === p.postId).map(({ postId: _, ...t }) => t),
        })),
      );
    },
  );

  server.registerTool(
    "save_post",
    {
      description:
        "Create a post, or edit a draft or scheduled post when postId is given. " +
        "mode=draft saves without scheduling, schedule needs scheduledAt, queue takes the next free " +
        "queue slot. More than one part makes a thread on X, Threads, Bluesky and Mastodon; other " +
        "networks use the first part. Instagram, Pinterest, YouTube, TikTok and DeviantArt need media. " +
        "Validation errors come back as text: fix the input and call again.",
      inputSchema: z.object({
        parts: z
          .array(z.object({ text: z.string(), mediaIds: z.array(z.uuid()).default([]) }))
          .min(1),
        accountIds: z.array(z.uuid()).default([]),
        options: z
          .record(z.string(), z.record(z.string(), z.string()))
          .default({})
          .describe("Per-account network options keyed by accountId, e.g. Pinterest board or Instagram type"),
        mode: z.enum(["draft", "schedule", "queue"]).default("draft"),
        scheduledAt: z.iso.datetime({ offset: true }).optional().describe("ISO 8601 with UTC offset"),
        postId: z.uuid().optional(),
      }),
    },
    async ({ parts, accountIds, options, mode, scheduledAt, postId }) => {
      const result = await savePostAs(user, {
        postId,
        parts,
        targets: accountIds.map((id) => ({ socialAccountId: id, override: null, options: options[id] ?? {} })),
        tagIds: [],
        mode,
        scheduledAt,
      });
      if (!result.ok) return fail(result.error);
      return json({ postId: result.postId, status: mode === "draft" ? "draft" : "scheduled", scheduledAt: result.scheduledAt });
    },
  );

  return server;
}
