import { openAsBlob } from "node:fs";
import { open } from "node:fs/promises";
import sharp from "sharp";
import { pkceChallenge } from "@/lib/crypto";
import type { MediaItem } from "@/lib/media";
import { NETWORKS } from "./catalog";
import { basicAuth, creds, fetchJson, NetworkError, pollUntil, secondsFromNow, sleep, url } from "./http";
import type { Account, Network, TokenSet } from "./types";

const API = "https://api.x.com/2";
const SCOPES = "tweet.read tweet.write users.read media.write offline.access";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CHUNK_BYTES = 4 * 1024 * 1024;

type Token = { access_token: string; refresh_token?: string; expires_in?: number };
type ProcessingInfo = { state?: string; check_after_secs?: number; error?: { message?: string } };
type MediaRes = { data?: { id?: string; processing_info?: ProcessingInfo }; id?: string; processing_info?: ProcessingInfo };

async function token(form: Record<string, string>): Promise<Token> {
  const { clientId, clientSecret } = creds("X");
  return fetchJson<Token>(`${API}/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(clientId, clientSecret) },
    form: { ...form, client_id: clientId },
  });
}

const tokenSet = (t: Token): TokenSet => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token,
  expiresAt: secondsFromNow(t.expires_in),
});

async function uploadImage(bearer: string, item: MediaItem): Promise<string> {
  const file =
    item.sizeBytes <= MAX_IMAGE_BYTES
      ? await openAsBlob(item.path, { type: item.mime })
      : new Blob([new Uint8Array(await sharp(item.path).rotate().resize(4096, 4096, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer())], { type: "image/jpeg" });
  const form = new FormData();
  form.append("media", file);
  form.append("media_category", "tweet_image");
  form.append("media_type", file.type);
  const res = await fetchJson<MediaRes>(`${API}/media/upload`, { method: "POST", bearer, body: form });
  return mediaId(res);
}

function mediaId(res: MediaRes): string {
  const id = res.data?.id ?? res.id;
  if (!id) throw new NetworkError(`X media upload returned no id: ${JSON.stringify(res).slice(0, 300)}`);
  return id;
}

/** Chunked upload for video and GIF: initialize, append, finalize, poll. */
async function uploadChunked(bearer: string, item: MediaItem): Promise<string> {
  const category = item.mime === "image/gif" ? "tweet_gif" : "tweet_video";
  const id = mediaId(
    await fetchJson<MediaRes>(`${API}/media/upload/initialize`, {
      method: "POST",
      bearer,
      json: { media_type: item.mime, total_bytes: item.sizeBytes, media_category: category },
    }),
  );
  const fh = await open(item.path);
  try {
    for (let i = 0, offset = 0; offset < item.sizeBytes; i++, offset += CHUNK_BYTES) {
      const buf = Buffer.alloc(Math.min(CHUNK_BYTES, item.sizeBytes - offset));
      await fh.read(buf, 0, buf.length, offset);
      const form = new FormData();
      form.append("media", new Blob([new Uint8Array(buf)]));
      form.append("segment_index", String(i));
      await fetchJson(`${API}/media/upload/${id}/append`, { method: "POST", bearer, body: form, timeoutMs: 5 * 60_000 });
    }
  } finally {
    await fh.close();
  }
  const fin = await fetchJson<MediaRes>(`${API}/media/upload/${id}/finalize`, { method: "POST", bearer });
  let info = fin.data?.processing_info ?? fin.processing_info;
  await pollUntil(
    async () => {
      if (!info || info.state === "succeeded") return true;
      if (info.state === "failed") throw new NetworkError(`X media processing failed: ${info.error?.message ?? ""}`);
      await sleep((info.check_after_secs ?? 5) * 1000);
      const s = await fetchJson<MediaRes>(url(`${API}/media/upload`, { command: "STATUS", media_id: id }), { bearer });
      info = s.data?.processing_info ?? s.processing_info;
      return undefined;
    },
    { intervalMs: 0, what: "X media processing", retryable: true },
  );
  return id;
}

async function uploadMedia(bearer: string, item: MediaItem): Promise<string> {
  const id = item.kind === "video" || item.mime === "image/gif" ? await uploadChunked(bearer, item) : await uploadImage(bearer, item);
  if (item.altText) {
    // Reason: alt text is nice-to-have; never fail the post over it.
    await fetchJson(`${API}/media/metadata`, {
      method: "POST",
      bearer,
      json: { id, metadata: { alt_text: { text: item.altText.slice(0, 1000) } } },
    }).catch(() => {});
  }
  return id;
}

const permalink = (acct: Account, id: string) =>
  `https://x.com/${acct.username || String(acct.meta.username ?? "i")}/status/${id}`;

export const x: Network = {
  id: "x",
  info: NETWORKS.x,
  connect: {
    kind: "oauth",
    async authorize(ctx) {
      return {
        url: url("https://x.com/i/oauth2/authorize", {
          response_type: "code",
          client_id: creds("X").clientId,
          redirect_uri: ctx.redirectUri,
          scope: SCOPES,
          state: ctx.state,
          code_challenge: pkceChallenge(ctx.codeVerifier),
          code_challenge_method: "S256",
        }),
      };
    },
    async exchange(ctx) {
      // Reason: X auth codes expire after 30s, so exchange before anything else.
      const t = await token({
        grant_type: "authorization_code",
        code: ctx.code,
        redirect_uri: ctx.redirectUri,
        code_verifier: ctx.codeVerifier,
      });
      const { data: me } = await fetchJson<{
        data: { id: string; name: string; username: string; profile_image_url?: string; subscription_type?: string };
      }>(url(`${API}/users/me`, { "user.fields": "name,username,profile_image_url,subscription_type" }), {
        bearer: t.access_token,
      });
      return [
        {
          providerAccountId: me.id,
          name: me.name || me.username,
          username: me.username,
          avatarUrl: me.profile_image_url?.replace("_normal", "_400x400"),
          ...tokenSet(t),
          meta: { username: me.username, subscriptionType: me.subscription_type ?? "None" },
        },
      ];
    },
  },

  async refresh(acct) {
    // X rotates refresh tokens: the old one is dead once this returns.
    return tokenSet(await token({ grant_type: "refresh_token", refresh_token: acct.refreshToken ?? "" }));
  },

  async publish(acct, part, ctx) {
    const mediaIds: string[] = [];
    for (const item of part.media) mediaIds.push(await uploadMedia(acct.accessToken, item));
    const res = await fetchJson<{ data: { id: string } }>(`${API}/tweets`, {
      method: "POST",
      bearer: acct.accessToken,
      json: {
        text: part.text,
        ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
        ...(ctx.replyTo ? { reply: { in_reply_to_tweet_id: ctx.replyTo.parent.id } } : {}),
      },
      final: true,
    });
    return { id: res.data.id, url: permalink(acct, res.data.id) };
  },

  async metrics(acct, id) {
    type PM = { like_count?: number; reply_count?: number; retweet_count?: number; quote_count?: number; impression_count?: number };
    const { data } = await fetchJson<{ data?: { public_metrics?: PM } }>(
      url(`${API}/tweets/${id}`, { "tweet.fields": "public_metrics" }),
      { bearer: acct.accessToken },
    );
    const m = data?.public_metrics;
    if (!m) return {};
    return {
      views: m.impression_count,
      likes: m.like_count,
      comments: m.reply_count,
      shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0),
    };
  },
};
