// TikTok Content Posting API, FILE_UPLOAD only (PULL_FROM_URL needs a
// verified domain). Metrics need the video.list scope, which we don't ask for.
import { open } from "node:fs/promises";
import type { MediaItem } from "@/lib/media";
import { NETWORKS } from "./catalog";
import { creds, fetchJson, NetworkError, pollUntil, secondsFromNow, url } from "./http";
import type { Network } from "./types";

const API = "https://open.tiktokapis.com/v2";
// user.info.profile is what grants the `username` field.
const SCOPES = "user.info.basic,user.info.profile,video.upload,video.publish";
const CHUNK = 10 * 1024 * 1024;
/** Status poll interval; TikTok allows 30 status fetches a minute. */
export const tiktokPoll = { intervalMs: 10_000 };

type Token = {
  open_id: string;
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

async function token(form: Record<string, string>): Promise<Token> {
  const t = await fetchJson<Token>(`${API}/oauth/token/`, { method: "POST", form }).catch((err) => {
    if (err instanceof NetworkError && err.message.includes("invalid_grant")) err.reconnect = true;
    throw err;
  });
  if (t.error) throw new NetworkError(`TikTok login failed: ${t.error_description || t.error}`, null, false, t.error === "invalid_grant");
  return t;
}

// Reason: post ids are int64; keep unsafe integers exact as strings.
const parse = (text: string) =>
  JSON.parse(text, ((_k: string, v: unknown, c?: { source?: string }) =>
    typeof v === "number" && Number.isInteger(v) && !Number.isSafeInteger(v) && c?.source ? c.source : v) as never);

/**
 * Call a TikTok API that wraps errors as {error: {code, message}}.
 * `mayRetry` = nothing visible exists yet, so 429/5xx can be retried.
 */
async function tt<T>(path: string, accessToken: string, json?: unknown, mayRetry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: json === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: json === undefined ? undefined : JSON.stringify(json),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new NetworkError(`TikTok request failed: ${(err as Error).message}`);
  }
  const text = await res.text();
  let body: { data?: T; error?: { code?: string; message?: string } } = {};
  try {
    body = parse(text);
  } catch {}
  const code = body.error?.code ?? (res.ok ? "ok" : `http_${res.status}`);
  if (res.ok && code === "ok") return body.data as T;
  if (code === "unaudited_client_can_only_post_to_private_accounts") {
    throw new NetworkError(
      "TikTok: this app isn't audited yet, so direct posts only work on a private account with \"Only me\" visibility. Use inbox mode instead, or make the TikTok account private.",
      res.status,
    );
  }
  const retryable = mayRetry && (res.status === 429 || res.status >= 500 || code === "rate_limit_exceeded");
  const reconnect = code === "access_token_invalid" || res.status === 401;
  throw new NetworkError(`TikTok ${code}: ${body.error?.message || text.slice(0, 300)}`, res.status, retryable, reconnect);
}

/** < 10 MB goes as one chunk; otherwise 10 MB chunks, the remainder merged into the last. */
export function chunking(size: number) {
  const chunkSize = Math.min(size, CHUNK);
  return { chunkSize, count: Math.max(1, Math.floor(size / chunkSize)) };
}

async function uploadChunks(uploadUrl: string, item: MediaItem, size: number, chunkSize: number, count: number) {
  const fh = await open(item.path);
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunkSize;
      const len = i === count - 1 ? size - start : chunkSize;
      const last = i === count - 1;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      let res: Response;
      try {
        res = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": item.mime,
            "Content-Length": String(len),
            "Content-Range": `bytes ${start}-${start + len - 1}/${size}`,
          },
          body: buf,
          signal: AbortSignal.timeout(10 * 60_000),
        });
      } catch (err) {
        // Once the last chunk may have landed, the post may exist: no blind retry.
        throw new NetworkError(`TikTok upload failed: ${(err as Error).message}`, null, !last);
      }
      if (res.status !== 201 && res.status !== 206) {
        const text = await res.text().catch(() => "");
        throw new NetworkError(`TikTok upload ${res.status}: ${text.slice(0, 300)}`, res.status, !last && (res.status === 429 || res.status >= 500));
      }
    }
  } finally {
    await fh.close();
  }
}

type Status = { status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] };

export const tiktok: Network = {
  id: "tiktok",
  info: NETWORKS.tiktok,
  connect: {
    kind: "oauth",
    async authorize(ctx) {
      return {
        url: url("https://www.tiktok.com/v2/auth/authorize/", {
          client_key: creds("TIKTOK").clientId,
          scope: SCOPES,
          response_type: "code",
          redirect_uri: ctx.redirectUri,
          state: ctx.state,
        }),
      };
    },
    async exchange(ctx) {
      const { clientId, clientSecret } = creds("TIKTOK");
      const t = await token({
        client_key: clientId,
        client_secret: clientSecret,
        code: ctx.code,
        grant_type: "authorization_code",
        redirect_uri: ctx.redirectUri,
      });
      type User = { open_id: string; avatar_url?: string; display_name?: string; username?: string };
      const { user } = await tt<{ user: User }>("/user/info/?fields=open_id,avatar_url,display_name,username", t.access_token);
      return [
        {
          providerAccountId: user.open_id || t.open_id,
          name: user.display_name || user.username || "TikTok",
          username: user.username ?? null,
          avatarUrl: user.avatar_url,
          accessToken: t.access_token,
          refreshToken: t.refresh_token,
          expiresAt: secondsFromNow(t.expires_in),
        },
      ];
    },
  },

  // Refresh tokens rotate: always hand back the new one.
  async refresh(acct) {
    const { clientId, clientSecret } = creds("TIKTOK");
    const t = await token({
      client_key: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: acct.refreshToken ?? "",
    });
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: secondsFromNow(t.expires_in) };
  },

  async publish(acct, part, ctx) {
    const video = part.media.find((m) => m.kind === "video");
    if (!video) throw new NetworkError("TikTok needs a video");
    const size = video.sizeBytes;
    const { chunkSize, count } = chunking(size);
    const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: count };
    type Init = { publish_id: string; upload_url: string };
    let init: Init;
    if (ctx.options.mode === "direct") {
      type Creator = { privacy_level_options: string[]; max_video_post_duration_sec?: number };
      const creator = await tt<Creator>("/post/publish/creator_info/query/", acct.accessToken, {});
      const allowed = creator.privacy_level_options ?? [];
      let privacy = ctx.options.privacy || "SELF_ONLY";
      if (!allowed.includes(privacy)) {
        if (!allowed.includes("SELF_ONLY")) throw new NetworkError(`TikTok doesn't allow ${privacy} for this account (allowed: ${allowed.join(", ")})`);
        ctx.log(`TikTok: ${privacy} isn't allowed for this account, posting as SELF_ONLY`);
        privacy = "SELF_ONLY";
      }
      const max = creator.max_video_post_duration_sec;
      if (max && video.durationSeconds && video.durationSeconds > max) {
        throw new NetworkError(`TikTok: video is ${video.durationSeconds}s, this account allows at most ${max}s`);
      }
      init = await tt<Init>("/post/publish/video/init/", acct.accessToken, {
        post_info: {
          title: [...part.text].slice(0, 2200).join(""),
          privacy_level: privacy,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info,
      });
    } else {
      init = await tt<Init>("/post/publish/inbox/video/init/", acct.accessToken, { source_info });
    }

    await uploadChunks(init.upload_url, video, size, chunkSize, count);

    const done = await pollUntil(
      async () => {
        const s = await tt<Status>("/post/publish/status/fetch/", acct.accessToken, { publish_id: init.publish_id }, false);
        if (s.status === "FAILED") throw new NetworkError(`TikTok publish failed: ${s.fail_reason ?? "unknown reason"}`);
        return s.status === "PUBLISH_COMPLETE" || s.status === "SEND_TO_USER_INBOX" ? s : undefined;
      },
      { intervalMs: tiktokPoll.intervalMs, what: "TikTok processing", retryable: false },
    );
    const postId = done.publicaly_available_post_id?.[0];
    const profile = acct.username ? `https://www.tiktok.com/@${acct.username}` : "https://www.tiktok.com";
    // Inbox uploads have no public URL until the user finishes them in the app.
    if (postId === undefined) return { id: init.publish_id, url: profile };
    return { id: String(postId), url: `${profile}/video/${postId}` };
  },
};
