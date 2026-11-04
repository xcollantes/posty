import { fetchUrl } from "@/lib/gcs";
import { asJpeg, type MediaItem } from "@/lib/media";
import { NETWORKS } from "./catalog";
import { metaFetch } from "./facebook";
import { creds, NetworkError, pollUntil, secondsFromNow, url } from "./http";
import type { Account, Network } from "./types";

const IG = "https://graph.instagram.com/v26.0";
const SCOPES =
  "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_insights";
const WEEK_MS = 7 * 24 * 3600_000;

type Params = Record<string, string | undefined>;

const get = <T>(token: string, path: string, params: Params = {}) =>
  metaFetch<T>(url(`${IG}/${path}`, { ...params, access_token: token }));
const post = <T>(token: string, path: string, params: Params, final = false) =>
  metaFetch<T>(`${IG}/${path}`, { method: "POST", form: { ...params, access_token: token }, final });

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
      return {
        url: url("https://www.instagram.com/oauth/authorize", {
          client_id: clientId,
          redirect_uri: ctx.redirectUri,
          response_type: "code",
          scope: SCOPES,
          state: ctx.state,
        }),
      };
    },
    async exchange(ctx) {
      const { clientId, clientSecret } = creds("INSTAGRAM");
      type Short = { access_token: string };
      const res = await metaFetch<Short & { data?: Short[] }>("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        form: {
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          redirect_uri: ctx.redirectUri,
          code: ctx.code.replace(/#_$/, ""),
        },
      });
      // Reason: docs show the token wrapped in `data[]`; the live API returns it flat.
      const short = res.data?.[0] ?? res;
      const long = await metaFetch<{ access_token: string; expires_in: number }>(
        url("https://graph.instagram.com/access_token", {
          grant_type: "ig_exchange_token",
          client_secret: clientSecret,
          access_token: short.access_token,
        }),
      );
      type Me = { user_id: string; username: string; name?: string; profile_picture_url?: string; account_type?: string };
      const me = await get<Me>(long.access_token, "me", {
        fields: "user_id,username,name,profile_picture_url,account_type",
      });
      return [
        {
          providerAccountId: String(me.user_id),
          name: me.name || me.username,
          username: me.username,
          avatarUrl: me.profile_picture_url ?? null,
          accessToken: long.access_token,
          expiresAt: secondsFromNow(long.expires_in),
          meta: { accountType: me.account_type },
        },
      ];
    },
  },

  async refresh(acct) {
    const t = await metaFetch<{ access_token: string; expires_in: number }>(
      url("https://graph.instagram.com/refresh_access_token", {
        grant_type: "ig_refresh_token",
        access_token: acct.accessToken,
      }),
    );
    return { accessToken: t.access_token, expiresAt: secondsFromNow(t.expires_in) };
  },

  shouldRefresh: (acct) => Date.now() - acct.tokenIssuedAt.getTime() > WEEK_MS,

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
