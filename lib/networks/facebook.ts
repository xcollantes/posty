import { openAsBlob } from "node:fs";
import type { MediaItem } from "@/lib/media";
import { NETWORKS } from "./catalog";
import { creds, type FetchOptions, fetchJson, NetworkError, url } from "./http";
import type { Account, Network, PublishResult } from "./types";

const GRAPH = "https://graph.facebook.com/v26.0";
const GRAPH_VIDEO = "https://graph-video.facebook.com/v26.0";
const RUPLOAD = "https://rupload.facebook.com/video-upload/v26.0";
const SCOPES =
  "pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_engagement,business_management,read_insights";
const UPLOAD_TIMEOUT = 10 * 60_000;

/** fetchJson for Meta APIs: a code-190 error (dead token, HTTP 400) means reconnect. */
export async function metaFetch<T = Record<string, unknown>>(u: string, opts: FetchOptions = {}): Promise<T> {
  try {
    return await fetchJson<T>(u, opts);
  } catch (err) {
    if (err instanceof NetworkError && /"code"\s*:\s*190\b/.test(err.message)) {
      throw new NetworkError(err.message, err.status, false, true);
    }
    throw err;
  }
}

type Page = { id: string; name: string; access_token: string; tasks?: string[]; picture?: { data?: { url?: string } } };
type Created = { id?: string; post_id?: string; video_id?: string };

const link = (id: string) => `https://www.facebook.com/${id}`;

async function uploadPhoto(acct: Account, item: MediaItem, fields: Record<string, string>, final = false) {
  const form = new FormData();
  form.append("source", await openAsBlob(item.path, { type: item.mime }), item.path.split("/").pop());
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return metaFetch<Created>(`${GRAPH}/${acct.providerAccountId}/photos`, {
    method: "POST",
    bearer: acct.accessToken,
    body: form,
    final,
    timeoutMs: UPLOAD_TIMEOUT,
  });
}

/** Reels and video stories: start → rupload by URL → finish (final). */
async function resumableVideo(acct: Account, edge: "video_reels" | "video_stories", item: MediaItem, finish: Record<string, string>) {
  const base = `${GRAPH}/${acct.providerAccountId}/${edge}`;
  const { video_id } = await metaFetch<{ video_id: string }>(base, {
    method: "POST",
    bearer: acct.accessToken,
    form: { upload_phase: "start" },
  });
  await metaFetch(`${RUPLOAD}/${video_id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${acct.accessToken}`, file_url: item.url },
    timeoutMs: UPLOAD_TIMEOUT,
  });
  const res = await metaFetch<Created>(base, {
    method: "POST",
    bearer: acct.accessToken,
    form: { upload_phase: "finish", video_id, ...finish },
    final: true,
  });
  return { ...res, video_id };
}

export const facebook: Network = {
  id: "facebook",
  info: NETWORKS.facebook,
  connect: {
    kind: "oauth",
    async authorize(ctx) {
      const { clientId } = creds("FACEBOOK");
      return {
        url: url("https://www.facebook.com/v26.0/dialog/oauth", {
          client_id: clientId,
          redirect_uri: ctx.redirectUri,
          state: ctx.state,
          response_type: "code",
          scope: SCOPES,
        }),
      };
    },
    async exchange(ctx) {
      const { clientId, clientSecret } = creds("FACEBOOK");
      const short = await metaFetch<{ access_token: string }>(
        url(`${GRAPH}/oauth/access_token`, {
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: ctx.redirectUri,
          code: ctx.code,
        }),
      );
      const long = await metaFetch<{ access_token: string }>(
        url(`${GRAPH}/oauth/access_token`, {
          grant_type: "fb_exchange_token",
          client_id: clientId,
          client_secret: clientSecret,
          fb_exchange_token: short.access_token,
        }),
      );
      const { data } = await metaFetch<{ data: Page[] }>(
        url(`${GRAPH}/me/accounts`, { fields: "id,name,access_token,tasks,picture{url}", limit: 100 }),
        { bearer: long.access_token },
      );
      const pages = data.filter((p) => !p.tasks || p.tasks.includes("CREATE_CONTENT"));
      if (!pages.length) throw new NetworkError("No Facebook Pages you can post to were granted to Posty");
      // Page tokens derived from a long-lived user token never expire.
      return pages.map((p) => ({
        providerAccountId: p.id,
        name: p.name,
        avatarUrl: p.picture?.data?.url ?? null,
        accessToken: p.access_token,
        expiresAt: null,
      }));
    },
  },

  async publish(acct, part, ctx) {
    const page = acct.providerAccountId;
    const type = ctx.options.type || "post";
    const images = part.media.filter((m) => m.kind === "image");
    const video = part.media.find((m) => m.kind === "video");

    if (type === "story") {
      if (video) {
        const res = await resumableVideo(acct, "video_stories", video, {});
        const id = res.post_id ?? res.video_id;
        return { id, url: link(id) };
      }
      const photo = await uploadPhoto(acct, images[0], { published: "false" });
      const res = await metaFetch<Created>(`${GRAPH}/${page}/photo_stories`, {
        method: "POST",
        bearer: acct.accessToken,
        form: { photo_id: String(photo.id) },
        final: true,
      });
      const id = String(res.post_id ?? res.id ?? photo.id);
      return { id, url: link(id) };
    }

    if (type === "reel" && video) {
      const { video_id } = await resumableVideo(acct, "video_reels", video, {
        video_state: "PUBLISHED",
        description: part.text,
      });
      return { id: video_id, url: `https://www.facebook.com/reel/${video_id}` };
    }

    if (video) {
      const res = await metaFetch<{ id: string }>(`${GRAPH_VIDEO}/${page}/videos`, {
        method: "POST",
        bearer: acct.accessToken,
        form: { file_url: video.url, description: part.text },
        final: true,
        timeoutMs: UPLOAD_TIMEOUT,
      });
      return { id: res.id, url: link(res.id) };
    }

    if (images.length === 1) {
      const img = images[0];
      const res = await uploadPhoto(
        acct,
        img,
        { caption: part.text, ...(img.altText ? { alt_text_custom: img.altText } : {}) },
        true,
      );
      const id = String(res.post_id ?? res.id);
      return { id, url: link(id) };
    }

    const attached: { media_fbid: string }[] = [];
    for (const img of images) {
      const res = await uploadPhoto(acct, img, {
        published: "false",
        ...(img.altText ? { alt_text_custom: img.altText } : {}),
      });
      attached.push({ media_fbid: String(res.id) });
    }
    const res = await metaFetch<{ id: string }>(`${GRAPH}/${page}/feed`, {
      method: "POST",
      bearer: acct.accessToken,
      form: { message: part.text, attached_media: attached.length ? JSON.stringify(attached) : undefined },
      final: true,
    });
    return { id: res.id, url: link(res.id) };
  },

  async firstComment(acct, post: PublishResult, text) {
    await metaFetch(`${GRAPH}/${post.id}/comments`, {
      method: "POST",
      bearer: acct.accessToken,
      form: { message: text },
    });
  },

  async metrics(acct, id) {
    // Reason: video/reel objects (ids without "_") have no `shares` field.
    const fields = `reactions.summary(true),comments.summary(true)${id.includes("_") ? ",shares" : ""}`;
    type Res = {
      reactions?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
    };
    const r = await metaFetch<Res>(url(`${GRAPH}/${id}`, { fields }), { bearer: acct.accessToken });
    return {
      likes: r.reactions?.summary?.total_count ?? null,
      comments: r.comments?.summary?.total_count ?? null,
      shares: r.shares?.count ?? 0,
    };
  },
};
