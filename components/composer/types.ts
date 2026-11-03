import type { PostPart } from "@/lib/db/schema";
import type { NetworkId } from "@/lib/networks/catalog";

export type ComposerAccount = {
  socialAccountId: string;
  network: NetworkId;
  name: string;
  username: string | null;
  avatar: string | null;
  needsReconnect: boolean;
  /** Only the client-safe parts of meta (boards, limits). */
  meta: Record<string, unknown>;
};

export type ComposerMedia = {
  mediaId: string;
  src: string;
  kind: "image" | "video";
  mime: string;
  width: number | null;
  height: number | null;
  altText: string;
  originalName: string;
};

export type ComposerTarget = {
  socialAccountId: string;
  override: { parts: PostPart[] } | null;
  options: Record<string, string>;
};

export type ComposerInitial = {
  postId?: string;
  status: string;
  parts: PostPart[];
  targets: ComposerTarget[];
  tagIds: string[];
  scheduledAt: string | null;
};

export type ComposerSnippet = { snippetId: string; kind: string; name: string; body: string };
export type ComposerTag = { tagId: string; name: string; color: string };
