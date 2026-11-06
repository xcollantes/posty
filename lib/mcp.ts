import { TZDate } from "@date-fns/tz";
import { McpServer } from "@modelcontextprotocol/server";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, type SQL } from "drizzle-orm";
import * as z from "zod";
import { publishedWithMetrics, sumTotals, totalsByNetwork } from "@/lib/analytics";
import type { CurrentUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { fetchRemote } from "@/lib/fetch-remote";
import { createIdeaGroup, deleteIdea, deleteIdeaGroup, ideaPostInput, listIdeaGroups, listIdeas, saveIdea } from "@/lib/ideas";
import {
  createUploadGrant,
  deleteMediaIfUnused,
  loadMedia,
  MAX_ALT_TEXT,
  saveUpload,
  toItem,
  UPLOAD_GRANT_SECONDS,
  type MediaItem,
} from "@/lib/media";
import {
  maxCharsFor,
  NETWORK_IDS,
  NETWORKS,
  optionErrors,
  safeMeta,
  type NetworkId,
} from "@/lib/networks/catalog";
import {
  deletePostChecked,
  loadPost,
  nextQueueSlot,
  retryFailedTargets,
  savePostAs,
  tagIdsFor,
  validateTargets,
  type SavePostInput,
  type TargetInput,
} from "@/lib/posts";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

const READ_ONLY = { readOnlyHint: true };
const DESTRUCTIVE = { destructiveHint: true };

const iso = z.iso.datetime({ offset: true });
const limit = (fallback: number) => z.number().int().min(1).max(100).default(fallback);
const offset = z.number().int().min(0).default(0);
const altText = z.string().max(MAX_ALT_TEXT).optional().describe("Describes the file for people using screen readers");
const tagNames = z.array(z.string().min(1).max(100));
const workspace = { workspaceId: z.uuid().describe("From list_workspaces") };

const part = z.object({ text: z.string(), mediaIds: z.array(z.uuid()).default([]) });
const target = z.object({
  accountId: z.uuid(),
  options: z
    .record(z.string(), z.string())
    .default({})
    .describe("Network options for this account. list_accounts shows the valid keys and choices"),
  parts: z.array(part).min(1).optional().describe("Different text or media for just this account"),
});
type TargetArg = z.infer<typeof target>;

const toTargets = (targets: TargetArg[]): TargetInput[] =>
  targets.map((t) => ({
    socialAccountId: t.accountId,
    override: t.parts ? { parts: t.parts } : null,
    options: t.options,
  }));

/** Accounts that don't exist, and options their networks would silently ignore. */
async function targetProblems(targets: TargetArg[]): Promise<string[]> {
  if (!targets.length) return [];
  const accounts = await db
    .select({ id: schema.socialAccounts.socialAccountId, network: schema.socialAccounts.network })
    .from(schema.socialAccounts)
    .where(inArray(schema.socialAccounts.socialAccountId, targets.map((t) => t.accountId)));
  const networks = new Map(accounts.map((a) => [a.id, a.network as NetworkId]));
  return targets.flatMap((t) => {
    const network = networks.get(t.accountId);
    return network ? optionErrors(network, t.options) : [`Unknown accountId: ${t.accountId}`];
  });
}

/**
 * Only here, not in savePostAs: the UI saves past times on purpose, to send a
 * missed post right away. A model that got the year wrong shouldn't do that.
 */
function scheduleProblem(at: string | null | undefined): string | null {
  if (!at) return "mode=schedule needs scheduledAt";
  if (new Date(at).getTime() <= Date.now()) {
    return `scheduledAt ${at} is in the past (it is now ${new Date().toISOString()}). Pick a future time, or use publish_post to send it now.`;
  }
  return null;
}

const mediaOut = ({ path: _, ...item }: MediaItem) => item;

/** Posts with their targets, tags and (optionally) latest metrics. */
async function hydratePosts(posts: (typeof schema.posts.$inferSelect)[], includeMetrics: boolean) {
  const ids = posts.map((p) => p.postId);
  if (!ids.length) return [];
  const [targets, tags, metrics] = await Promise.all([
    db
      .select({
        postTargetId: schema.postTargets.postTargetId,
        postId: schema.postTargets.postId,
        accountId: schema.postTargets.socialAccountId,
        network: schema.socialAccounts.network,
        account: schema.socialAccounts.name,
        status: schema.postTargets.status,
        url: schema.postTargets.url,
        error: schema.postTargets.error,
        options: schema.postTargets.options,
        contentOverride: schema.postTargets.contentOverride,
        publishedAt: schema.postTargets.publishedAt,
      })
      .from(schema.postTargets)
      .innerJoin(schema.socialAccounts, eq(schema.socialAccounts.socialAccountId, schema.postTargets.socialAccountId))
      .where(inArray(schema.postTargets.postId, ids)),
    db
      .select({ postId: schema.postTags.postId, name: schema.tags.name })
      .from(schema.postTags)
      .innerJoin(schema.tags, eq(schema.tags.tagId, schema.postTags.tagId))
      .where(inArray(schema.postTags.postId, ids)),
    includeMetrics ? publishedWithMetrics({ postIds: ids }) : [],
  ]);
  const metricsFor = new Map(metrics.map((m) => [m.postTargetId, m]));
  return posts.map((p) => ({
    postId: p.postId,
    status: p.status,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    parts: p.content.parts,
    tags: tags.filter((t) => t.postId === p.postId).map((t) => t.name),
    targets: targets
      .filter((t) => t.postId === p.postId)
      .map(({ postId: _, postTargetId, contentOverride, ...t }) => {
        const m = metricsFor.get(postTargetId);
        return {
          ...t,
          parts: contentOverride?.parts ?? null,
          ...(includeMetrics
            ? {
                metrics: m
                  ? { views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, clicks: m.clicks, updatedAt: m.fetchedAt }
                  : null,
              }
            : {}),
        };
      }),
  }));
}

function registerPostTools(server: McpServer, user: CurrentUser) {
  async function save(input: SavePostInput) {
    const result = await savePostAs(user, input);
    if (!result.ok) return fail(result.error);
    // Reason: drafts skip validation, so say now what would stop them scheduling.
    const warnings =
      input.mode === "draft" && input.targets.length ? await validateTargets(input.targets, input.parts) : [];
    return json({
      postId: result.postId,
      status: input.mode === "draft" ? "draft" : "scheduled",
      scheduledAt: result.scheduledAt,
      ...(warnings.length ? { warnings } : {}),
    });
  }

  server.registerTool(
    "list_workspaces",
    {
      description:
        "Start here. Each company has its own workspace, with its own accounts, posts, ideas, media, tags, snippets and " +
        "queue. Most tools take a workspaceId. If there's more than one and it isn't clear which the user means, ask.",
      annotations: READ_ONLY,
    },
    async () =>
      json(
        await db
          .select({ workspaceId: schema.workspaces.workspaceId, name: schema.workspaces.name })
          .from(schema.workspaces)
          .orderBy(asc(schema.workspaces.name)),
      ),
  );

  server.registerTool(
    "list_accounts",
    {
      description:
        "Returns the user, their timezone and the current local time, and this workspace's connected accounts with their " +
        "character and media limits and valid options (including Pinterest boards), its posting queue, and its tags.",
      inputSchema: z.object(workspace),
      annotations: READ_ONLY,
    },
    async ({ workspaceId }) => {
      const [accounts, slots, tags, nextSlot] = await Promise.all([
        // Reason: named columns, so tokens can never end up in a response.
        db
          .select({
            accountId: schema.socialAccounts.socialAccountId,
            network: schema.socialAccounts.network,
            name: schema.socialAccounts.name,
            username: schema.socialAccounts.username,
            isActive: schema.socialAccounts.isActive,
            needsReconnect: schema.socialAccounts.needsReconnect,
            meta: schema.socialAccounts.meta,
          })
          .from(schema.socialAccounts)
          .where(eq(schema.socialAccounts.workspaceId, workspaceId))
          .orderBy(asc(schema.socialAccounts.network), asc(schema.socialAccounts.name)),
        db
          .select()
          .from(schema.queueSlots)
          .where(eq(schema.queueSlots.workspaceId, workspaceId))
          .orderBy(asc(schema.queueSlots.dayOfWeek), asc(schema.queueSlots.time)),
        db.select({ name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.workspaceId, workspaceId)).orderBy(asc(schema.tags.name)),
        nextQueueSlot(workspaceId, user.timezone),
      ]);
      return json({
        user: { name: user.name, email: user.email },
        timezone: user.timezone,
        now: new TZDate(Date.now(), user.timezone).toISOString(),
        accounts: accounts.map(({ meta, ...a }) => {
          const network = a.network as NetworkId;
          const info = NETWORKS[network];
          const safe = safeMeta(meta);
          return {
            ...a,
            limits: {
              maxChars: maxCharsFor(network, safe),
              maxImages: info.maxImages,
              maxVideos: info.maxVideos,
              mixedMedia: info.mixedMedia,
              requiresMedia: info.requiresMedia,
              imageTypes: info.imageMimes,
              threads: info.threads,
            },
            options: info.options.map((f) => ({
              key: f.key,
              label: f.label,
              required: f.required ?? false,
              default: f.default,
              help: f.help,
              choices: f.choicesFromMeta ? (safe[f.choicesFromMeta] ?? []) : f.choices,
            })),
            warning: info.warning,
          };
        }),
        queue: {
          slots: slots.map(({ queueSlotId, dayOfWeek, time }) => ({ queueSlotId, dayOfWeek, time })),
          nextFreeSlot: nextSlot?.toISOString() ?? null,
          note: "dayOfWeek 0 is Sunday. Times are local to the user's timezone.",
        },
        tags: tags.map((t) => t.name),
      });
    },
  );

  server.registerTool(
    "list_posts",
    {
      description:
        "List posts, with each account's status, live URL and error. Filter by status, accounts, tags and dates. " +
        "Set includeMetrics only when asked about performance. For totals, use get_post_metrics.",
      inputSchema: z.object({
        ...workspace,
        status: z.array(z.enum(["draft", "scheduled", "published", "partial", "failed"])).optional(),
        accountIds: z.array(z.uuid()).optional(),
        tags: tagNames.optional(),
        scheduledFrom: iso.optional(),
        scheduledTo: iso.optional(),
        createdFrom: iso.optional(),
        createdTo: iso.optional(),
        sortBy: z.enum(["scheduledAt", "createdAt", "updatedAt"]).optional(),
        sortDirection: z.enum(["asc", "desc"]).optional(),
        includeMetrics: z.boolean().default(false),
        limit: limit(20),
        offset,
      }),
      annotations: READ_ONLY,
    },
    async (args) => {
      const { posts, postTargets, postTags, tags } = schema;
      const conditions: (SQL | undefined)[] = [
        eq(posts.workspaceId, args.workspaceId),
        args.status?.length ? inArray(posts.status, args.status) : undefined,
        args.accountIds?.length
          ? inArray(
              posts.postId,
              db.select({ id: postTargets.postId }).from(postTargets).where(inArray(postTargets.socialAccountId, args.accountIds)),
            )
          : undefined,
        args.tags?.length
          ? inArray(
              posts.postId,
              db
                .select({ id: postTags.postId })
                .from(postTags)
                .innerJoin(tags, eq(tags.tagId, postTags.tagId))
                .where(inArray(tags.name, args.tags)),
            )
          : undefined,
        args.scheduledFrom ? gte(posts.scheduledAt, new Date(args.scheduledFrom)) : undefined,
        args.scheduledTo ? lte(posts.scheduledAt, new Date(args.scheduledTo)) : undefined,
        args.createdFrom ? gte(posts.createdAt, new Date(args.createdFrom)) : undefined,
        args.createdTo ? lte(posts.createdAt, new Date(args.createdTo)) : undefined,
      ];
      const onlyScheduled = args.status?.length === 1 && args.status[0] === "scheduled";
      const column = posts[args.sortBy ?? (onlyScheduled ? "scheduledAt" : "updatedAt")];
      const direction = (args.sortDirection ?? (onlyScheduled ? "asc" : "desc")) === "asc" ? asc : desc;
      const rows = await db
        .select()
        .from(posts)
        .where(and(...conditions))
        .orderBy(direction(column))
        .limit(args.limit)
        .offset(args.offset);
      return json({
        posts: await hydratePosts(rows, args.includeMetrics),
        nextOffset: rows.length === args.limit ? args.offset + args.limit : null,
      });
    },
  );

  server.registerTool(
    "get_post",
    {
      description:
        "One post with its text, media URLs and alt text, per-account text and options, tags, and each account's " +
        "status, live URL and error. Set includeMetrics only when asked about performance.",
      inputSchema: z.object({ postId: z.uuid(), includeMetrics: z.boolean().default(false) }),
      annotations: READ_ONLY,
    },
    async ({ postId, includeMetrics }) => {
      const rows = await db.select().from(schema.posts).where(eq(schema.posts.postId, postId));
      const [post] = await hydratePosts(rows, includeMetrics);
      if (!post) return fail("Post not found");
      const mediaIds = [...post.parts, ...post.targets.flatMap((t) => t.parts ?? [])].flatMap((p) => p.mediaIds);
      return json({ ...post, media: (await loadMedia([...new Set(mediaIds)])).map(mediaOut) });
    },
  );

  server.registerTool(
    "create_post",
    {
      description:
        "Create a post for one or more accounts. mode=draft saves it (the default), schedule needs a future scheduledAt, " +
        "queue takes the next free queue slot. More than one part makes a thread on X, Threads, Bluesky and Mastodon; " +
        "other networks use the first part. Check list_accounts for each account's limits. To attach a file, get a " +
        "mediaId from upload_media_from_url or get_media_upload_url first. Pass ideaId to build the post from an idea: " +
        "anything you omit comes from the idea, and the idea leaves the board once the post is saved. " +
        "Errors come back as text: fix the input and call again.",
      inputSchema: z.object({
        ...workspace,
        parts: z.array(part).min(1).optional(),
        targets: z.array(target).optional(),
        tags: tagNames.optional().describe("Tag names. New names are created"),
        mode: z.enum(["draft", "schedule", "queue"]).optional(),
        scheduledAt: iso.optional().describe("ISO 8601 with a UTC offset"),
        ideaId: z.uuid().optional(),
      }),
    },
    async ({ workspaceId, parts, targets, tags, mode, scheduledAt, ideaId }) => {
      const idea = ideaId ? await ideaPostInput(ideaId) : null;
      if (ideaId && !idea) return fail("Idea not found");
      if (idea && idea.workspaceId !== workspaceId) return fail("That idea is in another workspace");
      const content = parts ?? idea?.parts;
      if (!content) return fail("Pass parts, or ideaId to use an idea's content");
      const problems = await targetProblems(targets ?? []);
      if (problems.length) return fail(problems.join("\n"));
      const nextMode = mode ?? (scheduledAt ? "schedule" : "draft");
      const problem = nextMode === "schedule" ? scheduleProblem(scheduledAt) : null;
      if (problem) return fail(problem);
      const result = await save({
        workspaceId,
        parts: content,
        targets: targets ? toTargets(targets) : (idea?.targets ?? []),
        tagIds: tags ? await tagIdsFor(tags, workspaceId) : (idea?.tagIds ?? []),
        mode: nextMode,
        scheduledAt,
      });
      if (ideaId && !("isError" in result)) await deleteIdea(ideaId);
      return result;
    },
  );

  server.registerTool(
    "edit_post",
    {
      description:
        "Change a draft, scheduled or failed post. Anything you omit keeps its current value, including the schedule. " +
        "parts, targets and tags each replace the whole list when given. Posts that have already gone out, even in " +
        "part, can't be edited: use get_post and create_post to make a new one.",
      inputSchema: z.object({
        postId: z.uuid(),
        parts: z.array(part).min(1).optional(),
        targets: z.array(target).optional(),
        tags: tagNames.optional(),
        mode: z.enum(["draft", "schedule", "queue"]).optional(),
        scheduledAt: iso.optional().describe("ISO 8601 with a UTC offset"),
      }),
    },
    async ({ postId, parts, targets, tags, mode, scheduledAt }) => {
      const post = await loadPost(postId);
      if (!post) return fail("Post not found");
      const problems = await targetProblems(targets ?? []);
      if (problems.length) return fail(problems.join("\n"));
      const nextMode = mode ?? (scheduledAt || post.status === "scheduled" ? "schedule" : "draft");
      const at = scheduledAt ?? post.scheduledAt;
      // Reason: checks a stored time too, or re-saving an overdue post would send it at once.
      const problem = nextMode === "schedule" ? scheduleProblem(at) : null;
      if (problem) return fail(problem);
      return save({
        workspaceId: post.workspaceId,
        postId,
        parts: parts ?? post.parts,
        targets: targets ? toTargets(targets) : post.targets,
        tagIds: tags ? await tagIdsFor(tags, post.workspaceId) : post.tagIds,
        mode: nextMode,
        scheduledAt: at,
      });
    },
  );

  server.registerTool(
    "publish_post",
    {
      description:
        "Send a draft or scheduled post to its accounts now. This goes live on the networks and can't be undone from " +
        "here. Only use it when the user asked to post now. The worker picks it up within seconds: check with get_post.",
      inputSchema: z.object({ postId: z.uuid() }),
      annotations: { ...DESTRUCTIVE, openWorldHint: true },
    },
    async ({ postId }) => {
      const post = await loadPost(postId);
      if (!post) return fail("Post not found");
      if (post.status !== "draft" && post.status !== "scheduled") {
        return fail(`This post is ${post.status}. Only drafts and scheduled posts can be published; use retry_post for failed ones.`);
      }
      return save({ workspaceId: post.workspaceId, postId, parts: post.parts, targets: post.targets, tagIds: post.tagIds, mode: "now" });
    },
  );

  server.registerTool(
    "retry_post",
    {
      description:
        "Send a failed post again now, to the accounts that failed. Accounts it already reached are left alone. This " +
        "goes live on the networks.",
      inputSchema: z.object({ postId: z.uuid() }),
      annotations: { ...DESTRUCTIVE, openWorldHint: true },
    },
    async ({ postId }) => {
      const halfDone = await db
        .select({ url: schema.postTargets.url })
        .from(schema.postTargets)
        .where(
          and(
            eq(schema.postTargets.postId, postId),
            eq(schema.postTargets.status, "failed"),
            isNotNull(schema.postTargets.providerPostId),
          ),
        );
      // Reason: this re-runs the thread from the top. A person can check the network first; a model can't.
      if (halfDone.length) {
        return fail(
          `Part of this post is already live (${halfDone.map((t) => t.url).join(", ")}), so retrying could post it twice. ` +
            "Ask the user to check the network and use Retry in the Posty UI.",
        );
      }
      const { error } = await retryFailedTargets(postId);
      return error ? fail(error) : json({ postId, status: "scheduled" });
    },
  );

  server.registerTool(
    "delete_post",
    {
      description:
        "Permanently delete a post and its metrics from Posty. Anything already live stays on the networks. Can't be undone.",
      inputSchema: z.object({ postId: z.uuid() }),
      annotations: DESTRUCTIVE,
    },
    async ({ postId }) => {
      const { error } = await deletePostChecked(postId);
      return error ? fail(error) : json({ postId, deleted: true });
    },
  );

  server.registerTool(
    "get_post_metrics",
    {
      description:
        "Totals across published posts, overall and per network, for a date range. Metrics refresh once a day for posts " +
        "from the last 30 days. null means the network never reported that number, not zero. LinkedIn shares none, and " +
        "X only when X_METRICS is on.",
      inputSchema: z.object({
        ...workspace,
        from: iso,
        to: iso,
        accountIds: z.array(z.uuid()).optional(),
        tags: tagNames.optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ workspaceId, from, to, accountIds, tags }) => {
      const tagRows = tags?.length
        ? await db
            .select({ tagId: schema.tags.tagId })
            .from(schema.tags)
            .where(and(eq(schema.tags.workspaceId, workspaceId), inArray(schema.tags.name, tags)))
        : null;
      const rows = await publishedWithMetrics({
        workspaceId,
        from: new Date(from),
        to: new Date(to),
        accountIds: accountIds?.length ? accountIds : undefined,
        tagIds: tagRows?.map((t) => t.tagId),
      });
      const byNetwork = totalsByNetwork(rows);
      const fetched = rows.flatMap((r) => (r.fetchedAt ? [r.fetchedAt.getTime()] : []));
      return json({
        from,
        to,
        totals: sumTotals(byNetwork.values()),
        byNetwork: Object.fromEntries(byNetwork),
        metricsUpdatedAt: fetched.length ? new Date(Math.max(...fetched)).toISOString() : null,
      });
    },
  );
}

function registerMediaTools(server: McpServer) {
  server.registerTool(
    "list_media",
    {
      description:
        "List files in the media library, newest first. Use a mediaId in a post's parts. To see an image, download its url.",
      inputSchema: z.object({ ...workspace, limit: limit(30), offset }),
      annotations: READ_ONLY,
    },
    async ({ workspaceId, limit: count, offset: skip }) => {
      const rows = await db
        .select()
        .from(schema.media)
        .where(eq(schema.media.workspaceId, workspaceId))
        .orderBy(desc(schema.media.createdAt))
        .limit(count)
        .offset(skip);
      return json({
        media: rows.map((r) => ({ ...mediaOut(toItem(r)), originalName: r.originalName, createdAt: r.createdAt })),
        nextOffset: rows.length === count ? skip + count : null,
      });
    },
  );

  server.registerTool(
    "upload_media_from_url",
    {
      description:
        "Add a JPEG, PNG, WebP, GIF, MP4 or MOV to the media library from a public URL, and get its mediaId. The URL must " +
        "point directly at the file, not a page showing it. For a file on this machine, use get_media_upload_url.",
      inputSchema: z.object({ ...workspace, url: z.url(), altText }),
    },
    async ({ workspaceId, url, altText: alt }) => {
      try {
        const { body, name } = await fetchRemote(url);
        return json(mediaOut(toItem(await saveUpload({ workspaceId, body, originalName: name, altText: alt }))));
      } catch (err) {
        const message = (err as Error).message;
        return fail(message.startsWith("Unsupported") ? `${message}. The URL must point directly at the file, not a page.` : message);
      }
    },
  );

  server.registerTool(
    "get_media_upload_url",
    {
      description:
        "Upload a file from this machine: get a short-lived URL and a curl command, run the command with your file's " +
        "path, and read the mediaId from its JSON output. Takes JPEG, PNG, WebP, GIF, MP4 or MOV, up to 1 GB.",
      inputSchema: z.object({ ...workspace, fileName: z.string().min(1).max(200), altText }),
    },
    async ({ workspaceId, fileName, altText: alt }) => {
      const uploadUrl = `${appUrl()}/api/media?token=${encodeURIComponent(createUploadGrant(workspaceId, fileName, alt))}`;
      return json({
        uploadUrl,
        expiresInSeconds: UPLOAD_GRANT_SECONDS,
        curl: `curl -sS --fail-with-body -X POST -T "<path to ${fileName}>" "${uploadUrl}"`,
      });
    },
  );

  server.registerTool(
    "update_media",
    {
      description: "Set a file's alt text. Networks that support alt text use it when the file is published.",
      inputSchema: z.object({ mediaId: z.uuid(), altText: z.string().max(MAX_ALT_TEXT) }),
    },
    async ({ mediaId, altText: alt }) => {
      const [row] = await db.update(schema.media).set({ altText: alt }).where(eq(schema.media.mediaId, mediaId)).returning();
      return row ? json(mediaOut(toItem(row))) : fail("File not found");
    },
  );

  server.registerTool(
    "delete_media",
    {
      description: "Permanently delete a file. Refused while an idea or a post that hasn't fully gone out still uses it.",
      inputSchema: z.object({ mediaId: z.uuid() }),
      annotations: DESTRUCTIVE,
    },
    async ({ mediaId }) => {
      const { error } = await deleteMediaIfUnused(mediaId);
      return error ? fail(error) : json({ mediaId, deleted: true });
    },
  );
}

function registerLibraryTools(server: McpServer) {
  const snippetKind = z.enum(["hashtags", "template"]);
  const snippetOut = ({ snippetId, kind, name, body }: typeof schema.snippets.$inferSelect) => ({ snippetId, kind, name, body });

  server.registerTool(
    "list_snippets",
    {
      description: "List saved hashtag groups and post templates, with their full text.",
      inputSchema: z.object({ ...workspace, kind: snippetKind.optional() }),
      annotations: READ_ONLY,
    },
    async ({ workspaceId, kind }) => {
      const rows = await db
        .select()
        .from(schema.snippets)
        .where(and(eq(schema.snippets.workspaceId, workspaceId), kind ? eq(schema.snippets.kind, kind) : undefined))
        .orderBy(asc(schema.snippets.kind), asc(schema.snippets.name));
      return json(rows.map(snippetOut));
    },
  );

  server.registerTool(
    "create_snippet",
    {
      description: "Save a hashtag group or post template. It also shows up in the composer.",
      inputSchema: z.object({ ...workspace, kind: snippetKind, name: z.string().min(1).max(200), body: z.string().min(1) }),
    },
    async (values) => {
      const [row] = await db.insert(schema.snippets).values(values).returning();
      return json(snippetOut(row));
    },
  );

  server.registerTool(
    "update_snippet",
    {
      description: "Change a snippet. Anything you omit stays as it is.",
      inputSchema: z.object({
        snippetId: z.uuid(),
        kind: snippetKind.optional(),
        name: z.string().min(1).max(200).optional(),
        body: z.string().min(1).optional(),
      }),
    },
    async ({ snippetId, ...values }) => {
      if (!Object.values(values).some((v) => v !== undefined)) return fail("Nothing to change");
      const [row] = await db.update(schema.snippets).set(values).where(eq(schema.snippets.snippetId, snippetId)).returning();
      return row ? json(snippetOut(row)) : fail("Snippet not found");
    },
  );

  server.registerTool(
    "delete_snippet",
    {
      description: "Permanently delete a snippet.",
      inputSchema: z.object({ snippetId: z.uuid() }),
      annotations: DESTRUCTIVE,
    },
    async ({ snippetId }) => {
      const rows = await db.delete(schema.snippets).where(eq(schema.snippets.snippetId, snippetId)).returning();
      return rows.length ? json({ snippetId, deleted: true }) : fail("Snippet not found");
    },
  );

  server.registerTool(
    "add_queue_slots",
    {
      description:
        "Add weekly times to this workspace's posting queue, which mode=queue fills in order. list_accounts shows the " +
        "current slots.",
      inputSchema: z.object({
        ...workspace,
        days: z.array(z.number().int().min(0).max(6)).min(1).describe("0 is Sunday"),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe("HH:MM in the user's timezone"),
      }),
    },
    async ({ workspaceId, days, time }) => {
      const rows = await db
        .insert(schema.queueSlots)
        .values([...new Set(days)].map((dayOfWeek) => ({ workspaceId, dayOfWeek, time })))
        .returning();
      return json(rows);
    },
  );

  server.registerTool(
    "delete_queue_slot",
    {
      description: "Remove a time from the posting queue. Posts already given that time keep it.",
      inputSchema: z.object({ queueSlotId: z.uuid() }),
      annotations: DESTRUCTIVE,
    },
    async ({ queueSlotId }) => {
      const rows = await db.delete(schema.queueSlots).where(eq(schema.queueSlots.queueSlotId, queueSlotId)).returning();
      return rows.length ? json({ queueSlotId, deleted: true }) : fail("Queue slot not found");
    },
  );

  const ideaOut = async ({ tags, ...idea }: Awaited<ReturnType<typeof listIdeas>>[number]) => ({
    ...idea,
    tags: tags.map((t) => t.name),
    media: (await loadMedia(idea.mediaIds)).map(mediaOut),
  });
  const ideaFields = {
    title: z.string().max(300).optional().describe("A label for the board. Not carried into the post unless there's no text"),
    text: z.string().optional(),
    mediaIds: z.array(z.uuid()).optional(),
    networks: z.array(z.enum(NETWORK_IDS)).optional().describe("Networks this idea is meant for"),
    tags: tagNames.optional().describe("Tag names. New names are created"),
    ideaGroupId: z.uuid().nullable().optional().describe("The board column. null is Unsorted"),
    targetAt: iso.nullable().optional().describe("When this should go out, as a plan. Nothing is scheduled by it"),
  };

  server.registerTool(
    "list_idea_groups",
    { description: "List the columns on the Ideas board.", inputSchema: z.object(workspace), annotations: READ_ONLY },
    async ({ workspaceId }) => json((await listIdeaGroups(workspaceId)).map(({ ideaGroupId, name }) => ({ ideaGroupId, name }))),
  );

  server.registerTool(
    "create_idea_group",
    {
      description: "Add a column to the Ideas board. If one with this name exists, returns it.",
      inputSchema: z.object({ ...workspace, name: z.string().min(1).max(100) }),
    },
    async ({ workspaceId, name }) => {
      const { ideaGroupId, name: saved } = await createIdeaGroup(workspaceId, name);
      return json({ ideaGroupId, name: saved });
    },
  );

  server.registerTool(
    "delete_idea_group",
    {
      description: "Remove a column from the Ideas board. Its ideas move to Unsorted.",
      inputSchema: z.object({ ideaGroupId: z.uuid() }),
      annotations: DESTRUCTIVE,
    },
    async ({ ideaGroupId }) =>
      (await deleteIdeaGroup(ideaGroupId)) ? json({ ideaGroupId, deleted: true }) : fail("Idea group not found"),
  );

  server.registerTool(
    "list_ideas",
    {
      description:
        "List ideas on the board, most recently changed first. Ideas are rough content for later: nothing on the board " +
        "gets published. Use create_post with ideaId to turn one into a post.",
      inputSchema: z.object({
        ...workspace,
        ideaGroupId: z.uuid().nullable().optional().describe("Only this column. null is Unsorted"),
        tags: tagNames.optional().describe("Ideas with any of these tags"),
        includeUntagged: z.boolean().optional().describe("With tags, also return ideas that have no tags"),
        limit: limit(20),
        offset,
      }),
      annotations: READ_ONLY,
    },
    async (filter) => {
      const ideas = await listIdeas(filter);
      return json({
        ideas: await Promise.all(ideas.map(ideaOut)),
        nextOffset: ideas.length === filter.limit ? filter.offset + filter.limit : null,
      });
    },
  );

  server.registerTool(
    "create_idea",
    {
      description: "Save an idea on the board for later. Needs at least a title, text or a file. This doesn't schedule anything.",
      inputSchema: z.object({ ...workspace, ...ideaFields }),
    },
    async (input) => {
      const result = await saveIdea(input);
      return result.ok ? json({ ideaId: result.ideaId }) : fail(result.error);
    },
  );

  server.registerTool(
    "update_idea",
    {
      description: "Change an idea or move it to another column. Anything you omit stays as it is.",
      inputSchema: z.object({ ideaId: z.uuid(), ...ideaFields }),
    },
    async ({ ideaId, ...input }) => {
      const result = await saveIdea(input, ideaId);
      return result.ok ? json({ ideaId: result.ideaId }) : fail(result.error);
    },
  );

  server.registerTool(
    "delete_idea",
    {
      description: "Permanently delete an idea. Its files stay in the media library.",
      inputSchema: z.object({ ideaId: z.uuid() }),
      annotations: DESTRUCTIVE,
    },
    async ({ ideaId }) => ((await deleteIdea(ideaId)) ? json({ ideaId, deleted: true }) : fail("Idea not found")),
  );
}

/** One MCP server per request, acting as `user`. */
export function buildServer(user: CurrentUser): McpServer {
  const server = new McpServer(
    { name: "posty", version: "0.2.0" },
    {
      instructions: [
        `Posty schedules social media posts. The user's timezone is ${user.timezone}.`,
        "Each company has its own workspace. Call list_workspaces first and never mix them up: if it isn't clear which one the user means, ask.",
        "Then call list_accounts with that workspaceId: it has the account IDs, each account's limits and valid options, and the current time.",
        "Never guess IDs. Default to mode=draft unless the user asked to schedule, queue or publish.",
        "Files: use upload_media_from_url for a public URL. For a file on this machine, call get_media_upload_url and run the curl command it returns. Both give a mediaId to put in a post's parts. Always write alt text.",
        "Times: scheduledAt is ISO 8601 with a UTC offset and must be in the future. Work out relative times like 'tomorrow' from list_accounts' now.",
        "One post can go to several accounts. Give an account its own parts when its network needs different text, such as X's shorter limit.",
        "Ideas are rough content on a board, and never publish. create_post with ideaId turns one into a post.",
      ].join("\n"),
    },
  );
  registerPostTools(server, user);
  registerMediaTools(server);
  registerLibraryTools(server);
  return server;
}
