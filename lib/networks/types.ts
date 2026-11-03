import type { MediaItem } from "@/lib/media";
import type { NetworkId, NetworkInfo } from "./catalog";

/** A connected account with decrypted tokens, as networks see it. */
export type Account = {
  socialAccountId: string;
  providerAccountId: string;
  name: string;
  username: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  tokenIssuedAt: Date;
  meta: Record<string, unknown>;
};

/** What a connect flow returns: one entry per account to store. */
export type ConnectedAccount = {
  providerAccountId: string;
  name: string;
  username?: string | null;
  /** Remote avatar URL; it's downloaded and stored locally. */
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  meta?: Record<string, unknown>;
};

export type TokenSet = {
  accessToken: string;
  /** undefined = keep the old refresh token; null = clear it. */
  refreshToken?: string | null;
  expiresAt?: Date | null;
  meta?: Record<string, unknown>;
};

export type Part = { text: string; media: MediaItem[] };

/**
 * Result of publishing one part. `extra` carries network-specific data the
 * next reply needs (e.g. Bluesky's cid).
 */
export type PublishResult = { id: string; url: string; extra?: Record<string, unknown> };

export type PublishContext = {
  /** Per-target per-part key, stable across retries (idempotency). */
  idempotencyKey: string;
  options: Record<string, string>;
  /** Set for every part after the first, when the network supports threads. */
  replyTo?: { root: PublishResult; parent: PublishResult };
  log: (msg: string) => void;
};

export type Metrics = {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  clicks?: number | null;
};

export type OAuthStart = {
  state: string;
  redirectUri: string;
  /** PKCE verifier; networks that use PKCE derive the challenge from it. */
  codeVerifier: string;
  /** Extra data the start step chose (e.g. Mastodon instance). */
  data: Record<string, string>;
};

export type OAuthConnect = {
  kind: "oauth";
  /** Optional form shown before redirecting (e.g. Mastodon instance URL). */
  preFields?: { name: string; label: string; placeholder?: string }[];
  /**
   * Build the authorize URL. May return extra data to keep in the signed
   * state cookie until the callback (e.g. dynamically registered client).
   */
  authorize(ctx: OAuthStart, input: Record<string, string>): Promise<{ url: string; data?: Record<string, string> }>;
  exchange(ctx: OAuthStart & { code: string }): Promise<ConnectedAccount[]>;
};

export type FormConnect = {
  kind: "form";
  fields: { name: string; label: string; type: "text" | "password" | "url"; placeholder?: string; help?: string }[];
  verify(input: Record<string, string>): Promise<ConnectedAccount[]>;
};

export type Network = {
  id: NetworkId;
  info: NetworkInfo;
  connect: OAuthConnect | FormConnect;
  /** Refresh or extend tokens. Absent = tokens don't expire (or can't refresh). */
  refresh?(acct: Account): Promise<TokenSet>;
  /** Should the hourly sweep refresh this account now, even if unused? */
  shouldRefresh?(acct: Account): boolean;
  publish(acct: Account, part: Part, ctx: PublishContext): Promise<PublishResult>;
  /** Comment on your own post. Networks with threads fall back to a reply. */
  firstComment?(acct: Account, post: PublishResult, text: string): Promise<void>;
  metrics?(acct: Account, providerPostId: string): Promise<Metrics>;
  /** Re-read account data shown in the composer (e.g. Pinterest boards). */
  refreshMeta?(acct: Account): Promise<Record<string, unknown>>;
};
