import { openAsBlob } from "node:fs";
import path from "node:path";
import { pkceChallenge } from "@/lib/crypto";
import { deviantArtTags, NETWORKS } from "./catalog";
import {
  creds,
  fetchJson,
  type FetchOptions,
  NetworkError,
  secondsFromNow,
  url,
} from "./http";
import type { Network, TokenSet } from "./types";

const OAUTH = "https://www.deviantart.com/oauth2";
const API = "https://www.deviantart.com/api/v1/oauth2";
const SCOPES = "basic user browse stash publish";

type Token = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};
type Stats = { views?: number; favourites?: number; comments?: number };

/** fetchJson that also throws on an error sent with HTTP 200. */
async function call<T>(target: string, opts: FetchOptions = {}): Promise<T> {
  // Reason: older DeviantArt docs say large uploads can fail this way.
  const res = await fetchJson<
    T & { status?: string; error_description?: string }
  >(target, opts);
  if (res.status === "error") {
    const reason = res.error_description ?? "request failed";
    throw new NetworkError(`DeviantArt: ${reason}`);
  }
  return res;
}

async function token(form: Record<string, string>): Promise<TokenSet> {
  const { clientId, clientSecret } = creds("DEVIANTART");
  const t = await call<Token>(`${OAUTH}/token`, {
    method: "POST",
    form: { ...form, client_id: clientId, client_secret: clientSecret },
  });
  // undefined keeps the old refresh token if DeviantArt didn't rotate it.
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: secondsFromNow(t.expires_in),
  };
}

export const deviantart: Network = {
  id: "deviantart",
  info: NETWORKS.deviantart,
  connect: {
    kind: "oauth",
    async authorize(ctx) {
      return {
        url: url(`${OAUTH}/authorize`, {
          response_type: "code",
          client_id: creds("DEVIANTART").clientId,
          redirect_uri: ctx.redirectUri,
          scope: SCOPES,
          state: ctx.state,
          code_challenge: pkceChallenge(ctx.codeVerifier),
          code_challenge_method: "S256",
        }),
      };
    },
    async exchange(ctx) {
      const t = await token({
        grant_type: "authorization_code",
        code: ctx.code,
        redirect_uri: ctx.redirectUri,
        code_verifier: ctx.codeVerifier,
      });
      const me = await call<{
        userid: string;
        username: string;
        usericon: string;
      }>(`${API}/user/whoami`, { bearer: t.accessToken });
      return [
        {
          providerAccountId: me.userid,
          name: me.username,
          username: me.username,
          avatarUrl: me.usericon,
          ...t,
        },
      ];
    },
  },

  async refresh(acct) {
    return token({
      grant_type: "refresh_token",
      refresh_token: acct.refreshToken ?? "",
    });
  },

  async publish(acct, part, ctx) {
    const image = part.media.find((m) => m.kind === "image");
    const title = ctx.options.title?.trim();
    if (!image) throw new NetworkError("DeviantArt needs an image");
    if (!title) throw new NetworkError("DeviantArt needs a title");

    const upload = new FormData();
    upload.append("title", title);
    upload.append("artist_comments", part.text);
    for (const tag of deviantArtTags(ctx.options.tags)) {
      upload.append("tags[]", tag);
    }
    upload.append(
      "file",
      await openAsBlob(image.path, { type: image.mime }),
      path.basename(image.path),
    );
    const { itemid } = await call<{ itemid: number }>(`${API}/stash/submit`, {
      method: "POST",
      bearer: acct.accessToken,
      body: upload,
      timeoutMs: 5 * 60_000,
    });

    // An unknown level is sent as-is so DeviantArt rejects it, rather than
    // the post going out marked as not mature.
    const mature = ctx.options.mature || "none";
    // Reason: a 429 here retries the whole publish. That can leave an unused
    // Sta.sh item, but never a second deviation.
    const deviation = await call<{ deviationid: string; url: string }>(
      `${API}/stash/publish`,
      {
        method: "POST",
        bearer: acct.accessToken,
        final: true,
        form: {
          itemid: String(itemid),
          is_mature: String(mature !== "none"),
          mature_level: mature === "none" ? undefined : mature,
          is_ai_generated:
            ctx.options.aiGenerated === "true" ? "true" : undefined,
          // The account owner chose this; docs/deviantart.md explains it.
          agree_submission: "1",
          agree_tos: "1",
        },
      },
    );
    return { id: deviation.deviationid, url: deviation.url };
  },

  async metrics(acct, id) {
    const res = await call<{ metadata: { stats?: Stats }[] }>(
      url(`${API}/deviation/metadata`, {
        "deviationids[]": id,
        ext_stats: "true",
      }),
      { bearer: acct.accessToken },
    );
    const stats = res.metadata[0]?.stats;
    return {
      views: stats?.views ?? null,
      likes: stats?.favourites ?? null,
      comments: stats?.comments ?? null,
    };
  },
};
