import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const workspaces = pgTable("workspaces", {
  workspaceId: uuid("workspace_id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

/**
 * Accounts, posts, ideas and media block deleting their workspace, so nothing
 * real is lost by accident. Settings-like rows (tags, snippets...) go with it.
 */
const workspaceId = (onDelete: "restrict" | "cascade") =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.workspaceId, { onDelete });

export const users = pgTable("users", {
  userId: uuid("user_id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  sessionId: text("session_id").primaryKey(), // sha256 of the cookie token
  userId: uuid("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** WebAuthn credentials. Passkeys are the only way to sign in. */
export const passkeys = pgTable("passkeys", {
  passkeyId: text("passkey_id").primaryKey(), // credential ID, base64url
  userId: uuid("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(), // COSE key, base64url
  counter: bigint("counter", { mode: "number" }).notNull().default(0), // uint32
  transports: jsonb("transports").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

/** One-time links that let a user without a passkey create one. */
export const signInLinks = pgTable("sign_in_links", {
  signInLinkId: text("sign_in_link_id").primaryKey(), // sha256 of the token
  userId: uuid("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const socialAccounts = pgTable(
  "social_accounts",
  {
    socialAccountId: uuid("social_account_id").primaryKey().defaultRandom(),
    workspaceId: workspaceId("restrict"),
    network: text("network").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    name: text("name").notNull(),
    username: text("username"),
    avatar: text("avatar"), // small data: URI, so no extra file route
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    tokenIssuedAt: timestamp("token_issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    needsReconnect: boolean("needs_reconnect").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("social_accounts_network_provider").on(t.network, t.providerAccountId)],
);

export const media = pgTable("media", {
  mediaId: uuid("media_id").primaryKey().defaultRandom(),
  workspaceId: workspaceId("restrict"),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  durationSeconds: integer("duration_seconds"),
  altText: text("alt_text").notNull().default(""),
  createdAt: createdAt(),
});

export type PostPart = { text: string; mediaIds: string[] };
export type PostContent = { parts: PostPart[] };

export const posts = pgTable("posts", {
  postId: uuid("post_id").primaryKey().defaultRandom(),
  workspaceId: workspaceId("restrict"),
  // draft | scheduled | published | partial | failed
  status: text("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  content: jsonb("content").$type<PostContent>().notNull(),
  createdBy: uuid("created_by").references(() => users.userId, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("posts_status_scheduled_at").on(t.status, t.scheduledAt)]);

export const postTargets = pgTable(
  "post_targets",
  {
    postTargetId: uuid("post_target_id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.postId, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.socialAccountId, { onDelete: "cascade" }),
    contentOverride: jsonb("content_override").$type<PostContent | null>(),
    options: jsonb("options").$type<Record<string, string>>().notNull().default({}),
    // pending | publishing | published | failed
    status: text("status").notNull().default("pending"),
    attemptCount: smallint("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    providerPostId: text("provider_post_id"),
    url: text("url"),
    error: text("error"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("post_targets_post_account").on(t.postId, t.socialAccountId),
    index("post_targets_status").on(t.status),
  ],
);

export const tags = pgTable(
  "tags",
  {
    tagId: uuid("tag_id").primaryKey().defaultRandom(),
    workspaceId: workspaceId("cascade"),
    name: text("name").notNull(),
    color: text("color").notNull().default("#0ea5e9"),
  },
  (t) => [uniqueIndex("tags_workspace_name").on(t.workspaceId, t.name)],
);

export const postTags = pgTable(
  "post_tags",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.postId, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.tagId, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] })],
);

export const snippets = pgTable("snippets", {
  snippetId: uuid("snippet_id").primaryKey().defaultRandom(),
  workspaceId: workspaceId("cascade"),
  kind: text("kind").notNull(), // hashtags | template
  name: text("name").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const ideaGroups = pgTable(
  "idea_groups",
  {
    ideaGroupId: uuid("idea_group_id").primaryKey().defaultRandom(),
    workspaceId: workspaceId("cascade"),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("idea_groups_workspace_name").on(t.workspaceId, t.name)],
);

export const ideas = pgTable("ideas", {
  ideaId: uuid("idea_id").primaryKey().defaultRandom(),
  workspaceId: workspaceId("restrict"),
  // null = Unsorted. Deleting a group keeps its ideas.
  ideaGroupId: uuid("idea_group_id").references(() => ideaGroups.ideaGroupId, { onDelete: "set null" }),
  title: text("title").notNull().default(""),
  text: text("text").notNull().default(""),
  mediaIds: jsonb("media_ids").$type<string[]>().notNull().default([]),
  networks: jsonb("networks").$type<string[]>().notNull().default([]),
  targetAt: timestamp("target_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ideaTags = pgTable(
  "idea_tags",
  {
    ideaId: uuid("idea_id")
      .notNull()
      .references(() => ideas.ideaId, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.tagId, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.ideaId, t.tagId] })],
);

export const queueSlots = pgTable("queue_slots", {
  queueSlotId: uuid("queue_slot_id").primaryKey().defaultRandom(),
  workspaceId: workspaceId("cascade"),
  dayOfWeek: smallint("day_of_week").notNull(), // 0 = Sunday
  time: text("time").notNull(), // HH:MM in the user's timezone
});

export const postMetrics = pgTable("post_metrics", {
  postMetricId: uuid("post_metric_id").primaryKey().defaultRandom(),
  postTargetId: uuid("post_target_id")
    .notNull()
    .references(() => postTargets.postTargetId, { onDelete: "cascade" }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  views: integer("views"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  clicks: integer("clicks"),
});

/** Small key/value store, e.g. per-instance Mastodon app credentials. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
});
