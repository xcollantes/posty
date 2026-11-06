import { openAsBlob } from "node:fs";
import sharp from "sharp";
import { decrypt, encrypt } from "@/lib/crypto";
import type { MediaItem } from "@/lib/media";
import { fetchOpenGraph } from "@/lib/og";
import { NETWORKS } from "./catalog";
import { fetchJson, NetworkError, pollUntil } from "./http";
import type { Account, Network, Part, PublishResult, TokenSet } from "./types";

const DEFAULT_SERVICE = "https://bsky.social";
const VIDEO_SERVICE = "https://video.bsky.app";
const MAX_IMAGE_BYTES = 950_000; // stay under the 1 MB blob limit older PDSes enforce

type Session = {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
  didDoc?: { service?: { id: string; serviceEndpoint: string }[] };
};

const pdsOf = (s: Session, fallback: string) =>
  s.didDoc?.service?.find((x) => x.id === "#atproto_pds")?.serviceEndpoint ?? fallback;

/** Read the `exp` claim of a JWT without verifying it. */
function jwtExpiry(jwt: string): Date | null {
  try {
    const { exp } = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    return exp ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

async function createSession(service: string, identifier: string, password: string): Promise<Session> {
  return fetchJson<Session>(`${service}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    json: { identifier, password },
  });
}

function sessionTokens(s: Session): TokenSet {
  return { accessToken: s.accessJwt, refreshToken: s.refreshJwt, expiresAt: jwtExpiry(s.accessJwt) };
}

// ---- Rich text facets (UTF-8 byte offsets) ----

export type Facet = {
  index: { byteStart: number; byteEnd: number };
  features: Record<string, string>[];
};

const encoder = new TextEncoder();

/** Find links, #tags and @mentions with their UTF-8 byte ranges. */
export function findFacets(text: string): { kind: "link" | "tag" | "mention"; value: string; byteStart: number; byteEnd: number }[] {
  const out: { kind: "link" | "tag" | "mention"; value: string; byteStart: number; byteEnd: number }[] = [];
  const byteAt = (i: number) => encoder.encode(text.slice(0, i)).length;
  const add = (kind: "link" | "tag" | "mention", value: string, start: number, len: number) =>
    out.push({ kind, value, byteStart: byteAt(start), byteEnd: byteAt(start + len) });

  for (const m of text.matchAll(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g)) add("link", m[0], m.index, m[0].length);
  for (const m of text.matchAll(/(^|\s)(#[^\d\s\p{P}][^\s\p{P}]*)/gu)) {
    add("tag", m[2].slice(1), m.index + m[1].length, m[2].length);
  }
  for (const m of text.matchAll(/(^|\s)(@([a-zA-Z0-9-]+\.)+[a-zA-Z][a-zA-Z0-9-]*)/g)) {
    add("mention", m[2].slice(1), m.index + m[1].length, m[2].length);
  }
  return out;
}

async function buildFacets(pds: string, token: string, text: string): Promise<Facet[]> {
  const facets: Facet[] = [];
  for (const f of findFacets(text)) {
    const index = { byteStart: f.byteStart, byteEnd: f.byteEnd };
    if (f.kind === "link") facets.push({ index, features: [{ $type: "app.bsky.richtext.facet#link", uri: f.value }] });
    if (f.kind === "tag") facets.push({ index, features: [{ $type: "app.bsky.richtext.facet#tag", tag: f.value }] });
    if (f.kind === "mention") {
      const did = await fetchJson<{ did: string }>(
        `${pds}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(f.value)}`,
        { bearer: token },
      ).then((r) => r.did, () => null);
      if (did) facets.push({ index, features: [{ $type: "app.bsky.richtext.facet#mention", did }] });
    }
  }
  return facets;
}

// ---- Media ----

type Blob = { $type: "blob"; ref: { $link: string }; mimeType: string; size: number };

async function uploadBlob(pds: string, token: string, data: Buffer | globalThis.Blob, mime: string): Promise<Blob> {
  const res = await fetchJson<{ blob: Blob }>(`${pds}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    bearer: token,
    headers: { "Content-Type": mime },
    body: Buffer.isBuffer(data) ? new Uint8Array(data) : data,
  });
  return res.blob;
}

async function imageBytes(item: MediaItem): Promise<{ data: Buffer | globalThis.Blob; mime: string }> {
  if (item.sizeBytes <= MAX_IMAGE_BYTES) return { data: await openAsBlob(item.path), mime: item.mime };
  for (const quality of [85, 70, 55]) {
    const data = await sharp(item.path).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality }).toBuffer();
    if (data.length <= MAX_IMAGE_BYTES) return { data, mime: "image/jpeg" };
  }
  throw new NetworkError("Image is too large for Bluesky even after compression");
}

async function uploadVideo(acct: Account, pds: string, item: MediaItem): Promise<Blob> {
  const did = acct.providerAccountId;
  const pdsHost = new URL(pds).host;
  const { token } = await fetchJson<{ token: string }>(
    `${pds}/xrpc/com.atproto.server.getServiceAuth?aud=${encodeURIComponent(`did:web:${pdsHost}`)}&lxm=com.atproto.repo.uploadBlob&exp=${Math.floor(Date.now() / 1000) + 1800}`,
    { bearer: acct.accessToken },
  );
  type Job = { jobId: string; state: string; blob?: Blob; error?: string };
  const name = `${item.mediaId}.mp4`;
  const res = await fetch(
    `${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(did)}&name=${name}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": item.mime }, body: await openAsBlob(item.path), signal: AbortSignal.timeout(15 * 60_000) },
  );
  const first = (await res.json()) as Job & { jobStatus?: Job };
  const job = first.jobStatus ?? first;
  if (job.blob) return job.blob; // already_exists still returns the blob
  if (!job.jobId) throw new NetworkError(`Bluesky video upload failed: ${JSON.stringify(first).slice(0, 300)}`, res.status, res.status >= 500);
  return pollUntil(async () => {
    const { jobStatus } = await fetchJson<{ jobStatus: Job }>(
      `${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus?jobId=${job.jobId}`,
      { bearer: token },
    );
    if (jobStatus.state === "JOB_STATE_FAILED") throw new NetworkError(`Bluesky video processing failed: ${jobStatus.error ?? ""}`);
    return jobStatus.blob;
  }, { what: "Bluesky video processing", retryable: true });
}

async function buildEmbed(acct: Account, pds: string, part: Part): Promise<Record<string, unknown> | undefined> {
  const images = part.media.filter((m) => m.kind === "image");
  const video = part.media.find((m) => m.kind === "video");
  if (video) {
    return {
      $type: "app.bsky.embed.video",
      video: await uploadVideo(acct, pds, video),
      alt: video.altText || undefined,
      // Reason: files added over MCP have no dimensions, and a guess distorts the player.
      ...(video.width && video.height ? { aspectRatio: { width: video.width, height: video.height } } : {}),
    };
  }
  if (images.length) {
    const uploaded = [];
    for (const img of images) {
      const { data, mime } = await imageBytes(img);
      uploaded.push({
        image: await uploadBlob(pds, acct.accessToken, data, mime),
        alt: img.altText,
        ...(img.width && img.height ? { aspectRatio: { width: img.width, height: img.height } } : {}),
      });
    }
    return { $type: "app.bsky.embed.images", images: uploaded };
  }
  // No media: turn the first link into a card, like the Bluesky app does.
  const link = findFacets(part.text).find((f) => f.kind === "link");
  if (!link) return undefined;
  const og = await fetchOpenGraph(link.value);
  if (!og) return undefined;
  let thumb: Blob | undefined;
  if (og.image) {
    const img = await fetch(og.image, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.arrayBuffer() : null), () => null);
    if (img) {
      const data = await sharp(Buffer.from(img)).resize(1200, 1200, { fit: "inside" }).jpeg({ quality: 75 }).toBuffer().catch(() => null);
      if (data && data.length < MAX_IMAGE_BYTES) thumb = await uploadBlob(pds, acct.accessToken, data, "image/jpeg");
    }
  }
  return { $type: "app.bsky.embed.external", external: { uri: og.url, title: og.title, description: og.description, ...(thumb ? { thumb } : {}) } };
}

function postUrl(handle: string, uri: string) {
  return `https://bsky.app/profile/${handle}/post/${uri.split("/").pop()}`;
}

export const bluesky: Network = {
  id: "bluesky",
  info: NETWORKS.bluesky,
  connect: {
    kind: "form",
    fields: [
      { name: "handle", label: "Handle", type: "text", placeholder: "you.bsky.social" },
      {
        name: "password",
        label: "App password",
        type: "password",
        help: "Create one in Bluesky → Settings → Privacy and security → App passwords. Never use your main password.",
      },
      { name: "service", label: "PDS / server (optional)", type: "url", placeholder: DEFAULT_SERVICE },
    ],
    async verify(input) {
      const service = (input.service?.trim() || DEFAULT_SERVICE).replace(/\/$/, "");
      const handle = input.handle.trim().replace(/^@/, "");
      const s = await createSession(service, handle, input.password.trim());
      const pds = pdsOf(s, service);
      const profile = await fetchJson<{ displayName?: string; avatar?: string }>(
        `${pds}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(s.did)}`,
        { bearer: s.accessJwt },
      ).catch(() => ({}) as { displayName?: string; avatar?: string });
      return [
        {
          providerAccountId: s.did,
          name: profile.displayName || s.handle,
          username: s.handle,
          avatarUrl: profile.avatar,
          ...sessionTokens(s),
          meta: { pds, service, handle: s.handle, appPasswordEnc: encrypt(input.password.trim()) },
        },
      ];
    },
  },

  async refresh(acct) {
    const pds = String(acct.meta.pds);
    try {
      const s = await fetchJson<Session>(`${pds}/xrpc/com.atproto.server.refreshSession`, {
        method: "POST",
        bearer: acct.refreshToken ?? "",
      });
      return sessionTokens(s);
    } catch {
      // Refresh token expired (90 days unused): log in again with the stored app password.
      const s = await createSession(String(acct.meta.service), String(acct.meta.handle), decrypt(String(acct.meta.appPasswordEnc)));
      return sessionTokens(s);
    }
  },

  async publish(acct, part, ctx) {
    const pds = String(acct.meta.pds);
    const record: Record<string, unknown> = {
      $type: "app.bsky.feed.post",
      text: part.text,
      createdAt: new Date().toISOString(),
      facets: await buildFacets(pds, acct.accessToken, part.text),
    };
    const embed = await buildEmbed(acct, pds, part);
    if (embed) record.embed = embed;
    if (ctx.replyTo) {
      const ref = (r: PublishResult) => ({ uri: r.id, cid: String(r.extra?.cid) });
      record.reply = { root: ref(ctx.replyTo.root), parent: ref(ctx.replyTo.parent) };
    }
    const res = await fetchJson<{ uri: string; cid: string }>(`${pds}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      bearer: acct.accessToken,
      json: { repo: acct.providerAccountId, collection: "app.bsky.feed.post", record },
      final: true,
    });
    return { id: res.uri, url: postUrl(String(acct.meta.handle), res.uri), extra: { cid: res.cid } };
  },

  async metrics(acct, providerPostId) {
    const pds = String(acct.meta.pds);
    const { posts } = await fetchJson<{ posts: { likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number }[] }>(
      `${pds}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(providerPostId)}`,
      { bearer: acct.accessToken },
    );
    const p = posts[0];
    if (!p) return {};
    return { likes: p.likeCount, comments: p.replyCount, shares: (p.repostCount ?? 0) + (p.quoteCount ?? 0) };
  },
};
