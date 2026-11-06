import { fetchUrl } from "@/lib/gcs";
import { asJpeg, type MediaItem } from "@/lib/media";
import { NETWORKS } from "./catalog";
import { GRAPH, metaFetch } from "./facebook";
import { creds, NetworkError, pollUntil, secondsFromNow, url } from "./http";
import type { Account, Network } from "./types";

type Params = Record<string, string | undefined>;

const get = <T>(token: string, path: string, params: Params = {}) =>
  metaFetch<T>(url(`${GRAPH}/${path}`, { ...params, access_token: token }));
const post = <T>(token: string, path: string, params: Params, final = false) =>
  metaFetch<T>(`${GRAPH}/${path}`, { method: "POST", form: { ...params, access_token: token }, final });

/** Create a media container and wait until Instagram has fetched and processed it. */
async function container(acct: Account, params: Params): Promise<string> {
  const { id } = await post<{ id: string }>(acct.accessToken, `${acct.providerAccountId}/media`, params);
  await pollUntil(async () => {
    const c = await get<{ status_code?: string; status?: string }>(acct.accessToken, id, { fields: "status_code,status" });
    if (c.status_code === "ERROR" || c.status_code === "EXPIRED") {
      throw new NetworkError(`Instagram media ${c.status_code}: ${c.status ?? ""}`);
    }
    return c.status_code === "FINISHED" ? true : undefined;
  }, { what: "Instagram media processing", retryable: true });
  return id;
}

const source = async (item: MediaItem): Promise<Params> =>
  item.kind === "video" ? { video_url: await fetchUrl(item) } : { image_url: await fetchUrl(await asJpeg(item)) };

export const instagram: Network = {
  id: "instagram",
  info: NETWORKS.instagram,
  connect: {
    kind: "oauth",
    async authorize(ctx) {
      const { clientId } = creds("INSTAGRAM");
      const configId = process.env.INSTAGRAM_CONFIG_ID;
      if (!configId) throw new NetworkError("Set INSTAGRAM_CONFIG_ID in .env (see docs/instagram.md)");
      return {
        // The configuration holds the permissions, so there's no `scope` here.
        url: url("https://www.facebook.com/dialog/oauth", {
          client_id: clientId,
          config_id: configId,
          redirect_uri: ctx.redirectUri,
          state: ctx.state,
          response_type: "code",
          override_default_response_type: "true",
          prompt: "login", // offer Instagram and Facebook login, so a 2nd account can be added
        }),
      };
    },
    async exchange(ctx) {
      const { clientId, clientSecret } = creds("INSTAGRAM");
      const { access_token: token, expires_in } = await metaFetch<{ access_token: string; expires_in?: number }>(
        url(`${GRAPH}/oauth/access_token`, {
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: ctx.redirectUri,
          code: ctx.code,
        }),
      );
      // Reason: this is a system-user token, so `/me` isn't the Instagram account.
      // ponytail: first page only, follow paging.cursors if anyone shares 100+ accounts.
      const { data } = await get<{ data: { id: string; username: string }[] }>(token, "me/assigned_instagram_accounts", {
        fields: "id,username",
        limit: "100",
      });
      return Promise.all(
        data.map(async ({ id, username }) => {
          // Reason: Meta only documents id and username here. A missing profile shouldn't block connecting.
          const profile = await get<{ name?: string; profile_picture_url?: string }>(token, id, {
            fields: "name,profile_picture_url",
          }).catch(() => ({ name: undefined, profile_picture_url: undefined }));
          return {
            providerAccountId: id,
            name: profile.name || username,
            username,
            avatarUrl: profile.profile_picture_url ?? null,
            accessToken: token,
            expiresAt: secondsFromNow(expires_in),
          };
        }),
      );
    },
  },

  async publish(acct, part, ctx) {
    const type = ctx.options.type || "feed";
    const [first] = part.media;
    let creationId: string;
    if (type === "story") {
      creationId = await container(acct, { media_type: "STORIES", ...(await source(first)) });
    } else if (type === "reel" || (part.media.length === 1 && first.kind === "video")) {
      // Standalone VIDEO is retired: single videos are reels shared to the feed.
      creationId = await container(acct, {
        media_type: "REELS",
        video_url: await fetchUrl(first),
        caption: part.text,
        share_to_feed: "true",
      });
    } else if (part.media.length === 1) {
      creationId = await container(acct, { ...(await source(first)), caption: part.text, alt_text: first.altText || undefined });
    } else {
      const children = await Promise.all(
        part.media.map(async (m) =>
          container(acct, {
            is_carousel_item: "true",
            ...(m.kind === "video" ? { media_type: "VIDEO" } : {}),
            ...(await source(m)),
          }),
        ),
      );
      creationId = await container(acct, { media_type: "CAROUSEL", children: children.join(","), caption: part.text });
    }
    const { id } = await post<{ id: string }>(
      acct.accessToken,
      `${acct.providerAccountId}/media_publish`,
      { creation_id: creationId },
      true,
    );
    // The post is live now: a failed permalink lookup must not fail the publish.
    const permalink = await get<{ permalink?: string }>(acct.accessToken, id, { fields: "permalink" })
      .then((r) => r.permalink, () => undefined);
    return { id, url: permalink ?? `https://www.instagram.com/${acct.username ?? ""}` };
  },

  async firstComment(acct, p, text) {
    await post(acct.accessToken, `${p.id}/comments`, { message: text });
  },

  async metrics(acct, id) {
    type Insight = { name: string; values?: { value: number }[]; total_value?: { value: number } };
    const { data } = await get<{ data: Insight[] }>(acct.accessToken, `${id}/insights`, {
      metric: "views,likes,comments,shares,saved",
    });
    const v = (name: string) => {
      const i = data.find((d) => d.name === name);
      return i?.total_value?.value ?? i?.values?.[0]?.value ?? null;
    };
    return { views: v("views"), likes: v("likes"), comments: v("comments"), shares: v("shares") };
  },
};
