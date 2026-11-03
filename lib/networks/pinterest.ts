import { openAsBlob } from "node:fs";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { MediaItem } from "@/lib/media";
import { NETWORKS } from "./catalog";
import { basicAuth, creds, fetchJson, NetworkError, pollUntil, request, secondsFromNow, url } from "./http";
import type { Network, Part, TokenSet } from "./types";

// Trial-access apps must write to the sandbox: PINTEREST_API_BASE=https://api-sandbox.pinterest.com/v5
const API = process.env.PINTEREST_API_BASE || "https://api.pinterest.com/v5";
const SCOPES = "user_accounts:read,boards:read,boards:write,pins:read,pins:write";

type Token = { access_token: string; refresh_token?: string; expires_in?: number };

async function token(form: Record<string, string>): Promise<TokenSet> {
  const { clientId, clientSecret } = creds("PINTEREST");
  const t = await fetchJson<Token>(`${API}/oauth/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(clientId, clientSecret) },
    form,
  });
  // undefined keeps the old refresh token if Pinterest didn't rotate it.
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: secondsFromNow(t.expires_in) };
}

async function loadBoards(bearer: string): Promise<{ value: string; label: string }[]> {
  const boards: { value: string; label: string }[] = [];
  let bookmark: string | undefined;
  do {
    const page = await fetchJson<{ items: { id: string; name: string }[]; bookmark?: string | null }>(
      url(`${API}/boards`, { page_size: 100, bookmark }),
      { bearer },
    );
    boards.push(...page.items.map((b) => ({ value: b.id, label: b.name })));
    bookmark = page.bookmark ?? undefined;
  } while (bookmark);
  return boards;
}

/** Base64 image; anything but JPEG/PNG is converted to JPEG. */
async function imageData(item: MediaItem): Promise<{ content_type: string; data: string }> {
  if (item.mime === "image/jpeg" || item.mime === "image/png") {
    return { content_type: item.mime, data: (await readFile(item.path)).toString("base64") };
  }
  const buf = await sharp(item.path).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
  return { content_type: "image/jpeg", data: buf.toString("base64") };
}

async function uploadVideo(bearer: string, item: MediaItem): Promise<string> {
  const reg = await fetchJson<{ media_id: string; upload_url: string; upload_parameters: Record<string, string> }>(
    `${API}/media`,
    { method: "POST", bearer, json: { media_type: "video" } },
  );
  const form = new FormData();
  for (const [k, v] of Object.entries(reg.upload_parameters)) form.append(k, v);
  form.append("file", await openAsBlob(item.path, { type: item.mime }));
  // Reason: pre-signed S3 upload; a bearer header would be rejected.
  await request(reg.upload_url, { method: "POST", body: form, timeoutMs: 15 * 60_000 });
  await pollUntil(
    async () => {
      const m = await fetchJson<{ status?: string }>(`${API}/media/${reg.media_id}`, { bearer });
      if (m.status === "failed") throw new NetworkError("Pinterest video processing failed");
      return m.status === "succeeded" ? true : undefined;
    },
    { what: "Pinterest video processing", retryable: true },
  );
  return reg.media_id;
}

async function mediaSource(bearer: string, part: Part): Promise<Record<string, unknown>> {
  const video = part.media.find((m) => m.kind === "video");
  if (video) return { source_type: "video_id", media_id: await uploadVideo(bearer, video), cover_image_key_frame_time: 1 };
  if (part.media.length === 1) return { source_type: "image_base64", ...(await imageData(part.media[0])) };
  const items = [];
  for (const img of part.media) items.push(await imageData(img));
  return { source_type: "multiple_image_base64", items };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export const pinterest: Network = {
  id: "pinterest",
  info: NETWORKS.pinterest,
  connect: {
    kind: "oauth",
    async authorize(ctx) {
      return {
        url: url("https://www.pinterest.com/oauth/", {
          response_type: "code",
          client_id: creds("PINTEREST").clientId,
          redirect_uri: ctx.redirectUri,
          scope: SCOPES,
          state: ctx.state,
        }),
      };
    },
    async exchange(ctx) {
      const t = await token({ grant_type: "authorization_code", code: ctx.code, redirect_uri: ctx.redirectUri });
      const me = await fetchJson<{ id?: string; username: string; profile_image?: string; business_name?: string }>(
        `${API}/user_account`,
        { bearer: t.accessToken },
      );
      return [
        {
          providerAccountId: me.id || me.username,
          name: me.business_name || me.username,
          username: me.username,
          avatarUrl: me.profile_image,
          ...t,
          meta: { boards: await loadBoards(t.accessToken) },
        },
      ];
    },
  },

  async refresh(acct) {
    return token({ grant_type: "refresh_token", refresh_token: acct.refreshToken ?? "" });
  },

  async refreshMeta(acct) {
    return { ...acct.meta, boards: await loadBoards(acct.accessToken) };
  },

  async publish(acct, part, ctx) {
    const boardId = ctx.options.boardId?.trim();
    if (!boardId) throw new NetworkError("Choose a Pinterest board");
    const pin = await fetchJson<{ id: string }>(`${API}/pins`, {
      method: "POST",
      bearer: acct.accessToken,
      json: {
        board_id: boardId,
        title: ctx.options.title || undefined,
        description: part.text,
        link: ctx.options.link || undefined,
        alt_text: part.media.find((m) => m.kind === "image")?.altText || undefined,
        media_source: await mediaSource(acct.accessToken, part),
      },
      final: true,
    });
    return { id: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/` };
  },

  async metrics(acct, id) {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86_400_000);
    type Daily = { metrics?: Record<string, number> };
    type Res = { all?: { lifetime_metrics?: Record<string, number>; daily_metrics?: Daily[] } };
    const res = await fetchJson<Res>(
      url(`${API}/pins/${id}/analytics`, {
        start_date: day(start),
        end_date: day(end),
        metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK",
      }),
      { bearer: acct.accessToken },
    );
    const totals: Record<string, number> = { ...res.all?.lifetime_metrics };
    if (!res.all?.lifetime_metrics) {
      for (const d of res.all?.daily_metrics ?? []) {
        for (const [k, v] of Object.entries(d.metrics ?? {})) totals[k] = (totals[k] ?? 0) + (Number(v) || 0);
      }
    }
    return {
      views: totals.IMPRESSION ?? null,
      shares: totals.SAVE ?? null,
      clicks: (totals.OUTBOUND_CLICK ?? 0) + (totals.PIN_CLICK ?? 0),
    };
  },
};
