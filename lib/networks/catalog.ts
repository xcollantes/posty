// Client-safe description of every network: limits, counters and the
// per-post options the composer shows. Server code lives in ./<id>.ts.
import twitter from "twitter-text";
import { codePoints, countWithUrls, graphemes, threadsCount, utf8Bytes } from "@/lib/text";

export const NETWORK_IDS = [
  "facebook",
  "instagram",
  "threads",
  "x",
  "linkedin",
  "pinterest",
  "youtube",
  "tiktok",
  "bluesky",
  "mastodon",
] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];

export type OptionField = {
  key: string;
  label: string;
  type: "select" | "text" | "textarea" | "checkbox";
  choices?: { value: string; label: string }[];
  /** Load choices from the account's meta (e.g. Pinterest boards). */
  choicesFromMeta?: string;
  default?: string;
  required?: boolean;
  help?: string;
};

export type NetworkInfo = {
  id: NetworkId;
  label: string;
  maxChars: number;
  /** Character count as the network sees it. `meta` is the account's meta. */
  count: (text: string, meta?: Record<string, unknown>) => number;
  maxImages: number;
  maxVideos: number;
  /** Images and a video in one post? */
  mixedMedia: boolean;
  requiresMedia: "none" | "any" | "video";
  imageMimes: string[];
  threads: boolean;
  firstComment: boolean;
  options: OptionField[];
  connectKind: "oauth" | "form";
  /** Shown in the composer and accounts page. */
  warning?: string;
};

const IMG = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const FIRST_COMMENT: OptionField = {
  key: "firstComment",
  label: "First comment",
  type: "textarea",
  help: "Posted as a reply/comment right after publishing.",
};

export const NETWORKS: Record<NetworkId, NetworkInfo> = {
  facebook: {
    id: "facebook",
    label: "Facebook Page",
    maxChars: 63206,
    count: codePoints,
    maxImages: 10,
    maxVideos: 1,
    mixedMedia: false,
    requiresMedia: "none",
    imageMimes: ["image/jpeg", "image/png", "image/gif"],
    threads: false,
    firstComment: true,
    connectKind: "oauth",
    options: [
      {
        key: "type",
        label: "Post type",
        type: "select",
        default: "post",
        choices: [
          { value: "post", label: "Feed post" },
          { value: "reel", label: "Reel (video)" },
          { value: "story", label: "Story" },
        ],
      },
      FIRST_COMMENT,
    ],
  },
  instagram: {
    id: "instagram",
    label: "Instagram",
    maxChars: 2200,
    count: codePoints,
    maxImages: 20,
    maxVideos: 20,
    mixedMedia: true,
    requiresMedia: "any",
    imageMimes: IMG,
    threads: false,
    firstComment: true,
    connectKind: "oauth",
    options: [
      {
        key: "type",
        label: "Post type",
        type: "select",
        default: "feed",
        choices: [
          { value: "feed", label: "Feed (image / carousel)" },
          { value: "reel", label: "Reel (video)" },
          { value: "story", label: "Story" },
        ],
      },
      FIRST_COMMENT,
    ],
    warning: "Images are converted to JPEG. Feed images must be between 4:5 and 1.91:1.",
  },
  threads: {
    id: "threads",
    label: "Threads",
    maxChars: 500,
    count: threadsCount,
    maxImages: 20,
    maxVideos: 20,
    mixedMedia: true,
    requiresMedia: "none",
    imageMimes: ["image/jpeg", "image/png"],
    threads: true,
    firstComment: true,
    connectKind: "oauth",
    options: [FIRST_COMMENT],
  },
  x: {
    id: "x",
    label: "X",
    maxChars: 280,
    count: (text, meta) => {
      const premium = meta?.subscriptionType && meta.subscriptionType !== "None";
      // Reason: twitter-text's weighting is what X enforces (URL = 23, emoji = 2).
      return premium ? codePoints(text) : twitter.parseTweet(text).weightedLength;
    },
    maxImages: 4,
    maxVideos: 1,
    mixedMedia: false,
    requiresMedia: "none",
    imageMimes: IMG,
    threads: true,
    firstComment: true,
    connectKind: "oauth",
    options: [FIRST_COMMENT],
    warning: "X API is pay-per-use: about $0.015 per post, $0.20 if the post contains a link.",
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    maxChars: 3000,
    count: codePoints,
    maxImages: 20,
    maxVideos: 1,
    mixedMedia: false,
    requiresMedia: "none",
    imageMimes: ["image/jpeg", "image/png", "image/gif"],
    threads: false,
    firstComment: true,
    connectKind: "oauth",
    options: [FIRST_COMMENT],
    warning: "LinkedIn tokens last 60 days and can't be refreshed: reconnect when prompted.",
  },
  pinterest: {
    id: "pinterest",
    label: "Pinterest",
    maxChars: 800,
    count: codePoints,
    maxImages: 5,
    maxVideos: 1,
    mixedMedia: false,
    requiresMedia: "any",
    imageMimes: ["image/jpeg", "image/png"],
    threads: false,
    firstComment: false,
    connectKind: "oauth",
    options: [
      { key: "boardId", label: "Board", type: "select", choicesFromMeta: "boards", required: true },
      { key: "title", label: "Title", type: "text", help: "Up to 100 characters." },
      { key: "link", label: "Destination link", type: "text" },
    ],
    warning: "Until your app has Standard access, pins are visible only to you.",
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    maxChars: 5000,
    count: utf8Bytes,
    maxImages: 0,
    maxVideos: 1,
    mixedMedia: false,
    requiresMedia: "video",
    imageMimes: [],
    threads: false,
    firstComment: false,
    connectKind: "oauth",
    options: [
      { key: "title", label: "Title", type: "text", required: true, help: "Up to 100 characters." },
      {
        key: "privacy",
        label: "Visibility",
        type: "select",
        default: "public",
        choices: [
          { value: "public", label: "Public" },
          { value: "unlisted", label: "Unlisted" },
          { value: "private", label: "Private" },
        ],
      },
    ],
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    maxChars: 2200,
    count: codePoints,
    maxImages: 0,
    maxVideos: 1,
    mixedMedia: false,
    requiresMedia: "video",
    imageMimes: [],
    threads: false,
    firstComment: false,
    connectKind: "oauth",
    options: [
      {
        key: "mode",
        label: "Mode",
        type: "select",
        default: "inbox",
        choices: [
          { value: "inbox", label: "Send to TikTok inbox (finish in app)" },
          { value: "direct", label: "Direct post" },
        ],
      },
      {
        key: "privacy",
        label: "Direct post visibility",
        type: "select",
        default: "SELF_ONLY",
        choices: [
          { value: "SELF_ONLY", label: "Only me" },
          { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends" },
          { value: "FOLLOWER_OF_CREATOR", label: "Followers" },
          { value: "PUBLIC_TO_EVERYONE", label: "Everyone" },
        ],
      },
    ],
    warning: "Unaudited TikTok apps can only direct-post privately (Only me). Inbox mode lets you publish publicly from the app.",
  },
  bluesky: {
    id: "bluesky",
    label: "Bluesky",
    maxChars: 300,
    count: graphemes,
    maxImages: 4,
    maxVideos: 1,
    mixedMedia: false,
    requiresMedia: "none",
    imageMimes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    threads: true,
    firstComment: true,
    connectKind: "form",
    options: [FIRST_COMMENT],
  },
  mastodon: {
    id: "mastodon",
    label: "Mastodon",
    maxChars: 500,
    count: (text) => countWithUrls(text, 23),
    maxImages: 4,
    maxVideos: 1,
    mixedMedia: false,
    requiresMedia: "none",
    imageMimes: IMG,
    threads: true,
    firstComment: true,
    connectKind: "oauth",
    options: [
      {
        key: "visibility",
        label: "Visibility",
        type: "select",
        default: "public",
        choices: [
          { value: "public", label: "Public" },
          { value: "unlisted", label: "Unlisted" },
          { value: "private", label: "Followers only" },
        ],
      },
      { key: "spoiler", label: "Content warning", type: "text" },
      FIRST_COMMENT,
    ],
  },
};

/** Character limit for an account (Mastodon instances and X Premium differ). */
export function maxCharsFor(id: NetworkId, meta?: Record<string, unknown>): number {
  if (id === "mastodon" && typeof meta?.maxChars === "number") return meta.maxChars;
  if (id === "x" && meta?.subscriptionType && meta.subscriptionType !== "None") return 25000;
  return NETWORKS[id].maxChars;
}

export type MediaLike = { kind: "image" | "video"; mime: string; width: number | null; height: number | null };

/** Problems with a post part for a network, as human-readable strings. */
export function validatePart(
  id: NetworkId,
  part: { text: string; media: MediaLike[] },
  options: Record<string, string>,
  meta?: Record<string, unknown>,
): string[] {
  const n = NETWORKS[id];
  const errors: string[] = [];
  const images = part.media.filter((m) => m.kind === "image");
  const videos = part.media.filter((m) => m.kind === "video");
  const count = n.count(part.text, meta);
  const max = maxCharsFor(id, meta);
  if (count > max) errors.push(`${n.label}: ${count}/${max} characters`);
  if (images.length > n.maxImages) errors.push(`${n.label}: at most ${n.maxImages} images`);
  if (videos.length > n.maxVideos) errors.push(`${n.label}: at most ${n.maxVideos} video`);
  if (!n.mixedMedia && images.length && videos.length) errors.push(`${n.label}: can't mix images and video`);
  if (n.requiresMedia === "any" && !part.media.length) errors.push(`${n.label}: needs an image or video`);
  if (n.requiresMedia === "video" && !videos.length) errors.push(`${n.label}: needs a video`);
  if (n.imageMimes.length && images.some((m) => !n.imageMimes.includes(m.mime) && id !== "instagram")) {
    errors.push(`${n.label}: unsupported image type`);
  }
  if (!part.text.trim() && !part.media.length) errors.push(`${n.label}: post is empty`);
  if (id === "instagram") {
    const type = options.type ?? "feed";
    if (type === "reel" && (videos.length !== 1 || images.length)) errors.push("Instagram: a reel needs exactly one video");
    if (type === "story" && part.media.length !== 1) errors.push("Instagram: a story needs exactly one image or video");
    if (type === "feed") {
      for (const m of images) {
        if (m.width && m.height) {
          const r = m.width / m.height;
          if (r < 0.8 - 0.01 || r > 1.91 + 0.01) errors.push("Instagram: feed images must be between 4:5 and 1.91:1");
        }
      }
    }
  }
  if (id === "facebook") {
    const type = options.type ?? "post";
    if (type === "reel" && videos.length !== 1) errors.push("Facebook: a reel needs exactly one video");
    if (type === "story" && part.media.length !== 1) errors.push("Facebook: a story needs exactly one image or video");
  }
  for (const f of n.options) {
    if (f.required && !options[f.key]?.trim()) errors.push(`${n.label}: ${f.label} is required`);
  }
  if (id === "youtube" && (options.title ?? "").length > 100) errors.push("YouTube: title is over 100 characters");
  if (id === "pinterest" && (options.title ?? "").length > 100) errors.push("Pinterest: title is over 100 characters");
  return [...new Set(errors)];
}
