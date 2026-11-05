// YouTube Data API v3. The Google OAuth consent screen must be "In
// production": in "Testing", refresh tokens expire after 7 days.
import { open } from "node:fs/promises";
import type { MediaItem } from "@/lib/media";
import { NETWORKS } from "./catalog";
import { creds, fetchJson, NetworkError, request, secondsFromNow, sleep, url } from "./http";
import type { Network } from "./types";

const SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KiB
const MAX_RESUMES = 3;

type Token = { access_token: string; expires_in?: number; refresh_token?: string };

async function token(form: Record<string, string>): Promise<Token> {
  return fetchJson<Token>(TOKEN_URL, { method: "POST", form }).catch((err) => {
    if (err instanceof NetworkError && err.message.includes("invalid_grant")) {
      throw new NetworkError("Google revoked the YouTube login; reconnect the account", err.status, false, true);
    }
    throw err;
  });
}

/**
 * PUT the file to a resumable session in 8 MiB chunks. 308 = keep going.
 * On a dropped connection or 5xx, ask the session how far it got and resume.
 */
async function uploadBytes(session: string, accessToken: string, item: MediaItem): Promise<{ id: string }> {
  const fh = await open(item.path);
  try {
    const total = (await fh.stat()).size;
    let start = 0;
    let failures = 0;
    let probe = false;
    for (;;) {
      let res: Response | null = null;
      try {
        const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
        let body: Buffer<ArrayBuffer> | undefined;
        if (probe) {
          headers["Content-Range"] = `bytes */${total}`;
        } else {
          const len = Math.min(CHUNK, total - start);
          body = Buffer.alloc(len);
          await fh.read(body, 0, len, start);
          headers["Content-Type"] = item.mime;
          headers["Content-Range"] = `bytes ${start}-${start + len - 1}/${total}`;
        }
        res = await fetch(session, { method: "PUT", headers, body, signal: AbortSignal.timeout(10 * 60_000) });
      } catch {
        // network error: fall through to resume
      }
      if (res?.status === 308) {
        const range = res.headers.get("Range"); // "bytes=0-N"; absent = nothing stored yet
        start = range ? Number(range.split("-")[1]) + 1 : 0;
        probe = false;
        continue;
      }
      if (res?.ok) return (await res.json()) as { id: string };
      if (res && res.status < 500) {
        const text = await res.text().catch(() => "");
        throw new NetworkError(`YouTube upload ${res.status}: ${text.slice(0, 500)}`, res.status, false, res.status === 401);
      }
      // The final chunk may have landed, so never retry the whole publish blindly.
      if (++failures > MAX_RESUMES) throw new NetworkError("YouTube upload kept failing; check YouTube Studio before retrying", res?.status ?? null);
      await sleep(1000 * failures);
      probe = true;
    }
  } finally {
    await fh.close();
  }
}

type Channel = { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } };
type Stats = { viewCount?: string; likeCount?: string; commentCount?: string };
const num = (s?: string) => (s === undefined ? null : Number(s));

export const youtube: Network = {
  id: "youtube",
  info: NETWORKS.youtube,
  connect: {
    kind: "oauth",
    async authorize(ctx) {
      return {
        url: url("https://accounts.google.com/o/oauth2/v2/auth", {
          client_id: creds("YOUTUBE").clientId,
          redirect_uri: ctx.redirectUri,
          response_type: "code",
          scope: SCOPES,
          access_type: "offline",
          prompt: "select_account consent", // chooser, so a 2nd Google account can be added
          include_granted_scopes: "true",
          state: ctx.state,
        }),
      };
    },
    async exchange(ctx) {
      const { clientId, clientSecret } = creds("YOUTUBE");
      const t = await token({
        code: ctx.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: ctx.redirectUri,
        grant_type: "authorization_code",
      });
      const { items = [] } = await fetchJson<{ items?: Channel[] }>(url(`${API}/channels`, { part: "snippet", mine: "true" }), {
        bearer: t.access_token,
      });
      if (!items.length) throw new NetworkError("This Google account has no YouTube channel. Create one on youtube.com, then connect again.");
      return items.map((c) => ({
        providerAccountId: c.id,
        name: c.snippet.title,
        username: c.snippet.customUrl ?? null,
        avatarUrl: c.snippet.thumbnails?.default?.url,
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: secondsFromNow(t.expires_in),
      }));
    },
  },

  async refresh(acct) {
    const { clientId, clientSecret } = creds("YOUTUBE");
    const t = await token({
      grant_type: "refresh_token",
      refresh_token: acct.refreshToken ?? "",
      client_id: clientId,
      client_secret: clientSecret,
    });
    // Google usually doesn't send a new refresh token: undefined keeps the old one.
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: secondsFromNow(t.expires_in) };
  },

  async publish(acct, part, ctx) {
    const video = part.media.find((m) => m.kind === "video");
    if (!video) throw new NetworkError("YouTube needs a video");
    // YouTube rejects "<" and ">" in titles and descriptions.
    const clean = (t: string) => t.replace(/[<>]/g, "");
    const title = [...clean(ctx.options.title?.trim() || part.text.split("\n")[0].trim() || "Untitled")].slice(0, 100).join("");
    const init = await request(url("https://www.googleapis.com/upload/youtube/v3/videos", { uploadType: "resumable", part: "snippet,status" }), {
      method: "POST",
      bearer: acct.accessToken,
      headers: { "X-Upload-Content-Length": String(video.sizeBytes), "X-Upload-Content-Type": video.mime },
      json: {
        snippet: { title, description: clean(part.text), categoryId: "22" },
        status: { privacyStatus: ctx.options.privacy || "public", selfDeclaredMadeForKids: false },
      },
    });
    const session = init.headers.get("Location");
    if (!session) throw new NetworkError("YouTube didn't return an upload session", init.status, true);
    const { id } = await uploadBytes(session, acct.accessToken, video);
    return { id, url: `https://www.youtube.com/watch?v=${id}` };
  },

  async metrics(acct, id) {
    const { items = [] } = await fetchJson<{ items?: { statistics: Stats }[] }>(url(`${API}/videos`, { part: "statistics", id }), {
      bearer: acct.accessToken,
    });
    const s = items[0]?.statistics;
    if (!s) return {};
    return { views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) };
  },
};
