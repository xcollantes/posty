import { fetchUrl } from "@/lib/gcs";
import type { MediaItem } from "@/lib/media";
import { NETWORKS } from "./catalog";
import { metaFetch } from "./facebook";
import { creds, NetworkError, pollUntil, secondsFromNow, url } from "./http";
import type { Account, Network, PublishResult } from "./types";

const TH = "https://graph.threads.com";
const API = `${TH}/v1.0`;
const SCOPES = "threads_basic,threads_content_publish,threads_manage_replies,threads_manage_insights";
const WEEK_MS = 7 * 24 * 3600_000;

type Params = Record<string, string | undefined>;

const get = <T>(token: string, path: string, params: Params = {}) =>
  metaFetch<T>(url(`${API}/${path}`, { ...params, access_token: token }));
const post = <T>(token: string, path: string, params: Params, final = false) =>
  metaFetch<T>(`${API}/${path}`, { method: "POST", form: { ...params, access_token: token }, final });

/** Create a container and wait until Threads has processed it. */
async function container(acct: Account, params: Params): Promise<string> {
  const { id } = await post<{ id: string }>(acct.accessToken, `${acct.providerAccountId}/threads`, params);
  await pollUntil(async () => {
    const c = await get<{ status?: string; error_message?: string }>(acct.accessToken, id, {
      fields: "status,error_message",
    });
    if (c.status === "ERROR" || c.status === "EXPIRED") {
      throw new NetworkError(`Threads media ${c.status}: ${c.error_message ?? ""}`);
    }
    return c.status === "FINISHED" ? true : undefined;
  }, { what: "Threads media processing", retryable: true });
  return id;
}

async function publishContainer(acct: Account, creationId: string): Promise<PublishResult> {
  const { id } = await post<{ id: string }>(
    acct.accessToken,
    `${acct.providerAccountId}/threads_publish`,
    { creation_id: creationId },
    true,
  );
  // The post is live now: a failed permalink lookup must not fail the publish.
  const permalink = await get<{ permalink?: string }>(acct.accessToken, id, { fields: "permalink" })
    .then((r) => r.permalink, () => undefined);
  return { id, url: permalink ?? `https://www.threads.com/@${acct.username ?? ""}` };
}

const source = async (m: MediaItem): Promise<Params> =>
  m.kind === "video"
    ? { media_type: "VIDEO", video_url: await fetchUrl(m), alt_text: m.altText || undefined }
    : { media_type: "IMAGE", image_url: await fetchUrl(m), alt_text: m.altText || undefined };

export const threads: Network = {
  id: "threads",
  info: NETWORKS.threads,
  connect: {
    kind: "oauth",
    async authorize(ctx) {
      const { clientId } = creds("THREADS");
      return {
        url: url("https://threads.com/oauth/authorize", {
          client_id: clientId,
          redirect_uri: ctx.redirectUri,
          scope: SCOPES,
          response_type: "code",
          state: ctx.state,
        }),
      };
    },
    async exchange(ctx) {
      const { clientId, clientSecret } = creds("THREADS");
      const short = await metaFetch<{ access_token: string }>(`${TH}/oauth/access_token`, {
        method: "POST",
        form: {
          client_id: clientId,
          client_secret: clientSecret,
          code: ctx.code.replace(/#_$/, ""),
          grant_type: "authorization_code",
          redirect_uri: ctx.redirectUri,
        },
      });
      const long = await metaFetch<{ access_token: string; expires_in: number }>(
        url(`${TH}/access_token`, {
          grant_type: "th_exchange_token",
          client_secret: clientSecret,
          access_token: short.access_token,
        }),
      );
      type Me = { id: string; username: string; name?: string; threads_profile_picture_url?: string };
      const me = await get<Me>(long.access_token, "me", { fields: "id,username,name,threads_profile_picture_url" });
      return [
        {
          providerAccountId: me.id,
          name: me.name || me.username,
          username: me.username,
          avatarUrl: me.threads_profile_picture_url ?? null,
          accessToken: long.access_token,
          expiresAt: secondsFromNow(long.expires_in),
        },
      ];
    },
  },

  async refresh(acct) {
    const t = await metaFetch<{ access_token: string; expires_in: number }>(
      url(`${TH}/refresh_access_token`, { grant_type: "th_refresh_token", access_token: acct.accessToken }),
    );
    return { accessToken: t.access_token, expiresAt: secondsFromNow(t.expires_in) };
  },

  shouldRefresh: (acct) => Date.now() - acct.tokenIssuedAt.getTime() > WEEK_MS,

  async publish(acct, part, ctx) {
    const { media, text } = part;
    let params: Params;
    if (!media.length) params = { media_type: "TEXT", text };
    else if (media.length === 1) params = { ...(await source(media[0])), text };
    else {
      const children = await Promise.all(media.map(async (m) => container(acct, { ...(await source(m)), is_carousel_item: "true" })));
      params = { media_type: "CAROUSEL", children: children.join(","), text };
    }
    return publishContainer(acct, await container(acct, { ...params, reply_to_id: ctx.replyTo?.parent.id }));
  },

  async firstComment(acct, p, text) {
    await publishContainer(acct, await container(acct, { media_type: "TEXT", text, reply_to_id: p.id }));
  },

  async metrics(acct, id) {
    type Insight = { name: string; values?: { value: number }[]; total_value?: { value: number } };
    const { data } = await get<{ data: Insight[] }>(acct.accessToken, `${id}/insights`, {
      metric: "views,likes,replies,reposts,quotes,shares",
    });
    const v = (name: string) => {
      const i = data.find((d) => d.name === name);
      return i?.total_value?.value ?? i?.values?.[0]?.value ?? null;
    };
    return {
      views: v("views"),
      likes: v("likes"),
      comments: v("replies"),
      shares: (v("reposts") ?? 0) + (v("quotes") ?? 0) + (v("shares") ?? 0),
    };
  },
};
