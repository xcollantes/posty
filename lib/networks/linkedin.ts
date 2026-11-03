import { openAsBlob } from "node:fs";
import { open } from "node:fs/promises";
import type { MediaItem } from "@/lib/media";
import { NETWORKS } from "./catalog";
import { creds, fetchJson, NetworkError, pollUntil, request, secondsFromNow, sleep, url } from "./http";
import type { Account, Network, Part } from "./types";

const REST = "https://api.linkedin.com/rest";
const SCOPES = "openid profile w_member_social";
const HEADERS = { "LinkedIn-Version": "202610", "X-Restli-Protocol-Version": "2.0.0" };

/**
 * Escape LinkedIn "little text" reserved characters so the commentary
 * isn't truncated or mangled. `#word` hashtags stay unescaped.
 */
export function escapeLittleText(text: string): string {
  return text.replace(/(^|\s)(#[\p{L}\p{N}]+)|[|{}@[\]()<>\\*_~#]/gu, (m, _pre, tag) => (tag ? m : `\\${m}`));
}

const personUrn = (acct: Account) => `urn:li:person:${acct.providerAccountId}`;

async function uploadImage(acct: Account, item: MediaItem): Promise<string> {
  const { value } = await fetchJson<{ value: { uploadUrl: string; image: string } }>(
    `${REST}/images?action=initializeUpload`,
    { method: "POST", bearer: acct.accessToken, headers: HEADERS, json: { initializeUploadRequest: { owner: personUrn(acct) } } },
  );
  await request(value.uploadUrl, {
    method: "PUT",
    bearer: acct.accessToken,
    headers: { "Content-Type": item.mime },
    body: await openAsBlob(item.path),
    timeoutMs: 5 * 60_000,
  });
  return value.image;
}

async function uploadVideo(acct: Account, item: MediaItem): Promise<string> {
  type Init = {
    value: { video: string; uploadToken?: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] };
  };
  const { value } = await fetchJson<Init>(`${REST}/videos?action=initializeUpload`, {
    method: "POST",
    bearer: acct.accessToken,
    headers: HEADERS,
    json: {
      initializeUploadRequest: { owner: personUrn(acct), fileSizeBytes: item.sizeBytes, uploadCaptions: false, uploadThumbnail: false },
    },
  });
  const etags: string[] = [];
  const fh = await open(item.path);
  try {
    for (const part of value.uploadInstructions) {
      const buf = Buffer.alloc(part.lastByte - part.firstByte + 1);
      await fh.read(buf, 0, buf.length, part.firstByte);
      // Reason: upload URLs are pre-signed; no bearer needed.
      const res = await request(part.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(buf),
        timeoutMs: 5 * 60_000,
      });
      const etag = res.headers.get("etag");
      if (!etag) throw new NetworkError("LinkedIn video upload returned no etag", null, true);
      etags.push(etag);
    }
  } finally {
    await fh.close();
  }
  await request(`${REST}/videos?action=finalizeUpload`, {
    method: "POST",
    bearer: acct.accessToken,
    headers: HEADERS,
    json: { finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken ?? "", uploadedPartIds: etags } },
  });
  const status = await pollUntil(
    async () => {
      try {
        const v = await fetchJson<{ status?: string }>(`${REST}/videos/${encodeURIComponent(value.video)}`, {
          bearer: acct.accessToken,
          headers: HEADERS,
        });
        if (v.status === "PROCESSING_FAILED") throw new NetworkError("LinkedIn video processing failed");
        return v.status === "AVAILABLE" ? "ok" : undefined;
      } catch (err) {
        // Reason: w_member_social may not allow reading videos back.
        if (err instanceof NetworkError && err.status === 403) return "unknown";
        throw err;
      }
    },
    { what: "LinkedIn video processing", retryable: true },
  );
  if (status === "unknown") await sleep(30_000);
  return value.video;
}

async function buildContent(acct: Account, part: Part): Promise<Record<string, unknown> | undefined> {
  const video = part.media.find((m) => m.kind === "video");
  if (video) return { media: { id: await uploadVideo(acct, video) } };
  const images = [];
  for (const img of part.media) images.push({ id: await uploadImage(acct, img), altText: img.altText || undefined });
  if (images.length === 1) return { media: images[0] };
  if (images.length > 1) return { multiImage: { images } };
  return undefined;
}

export const linkedin: Network = {
  id: "linkedin",
  info: NETWORKS.linkedin,
  connect: {
    kind: "oauth",
    async authorize(ctx) {
      return {
        url: url("https://www.linkedin.com/oauth/v2/authorization", {
          response_type: "code",
          client_id: creds("LINKEDIN").clientId,
          redirect_uri: ctx.redirectUri,
          state: ctx.state,
          scope: SCOPES,
        }),
      };
    },
    async exchange(ctx) {
      const { clientId, clientSecret } = creds("LINKEDIN");
      const t = await fetchJson<{ access_token: string; expires_in?: number }>(
        "https://www.linkedin.com/oauth/v2/accessToken",
        {
          method: "POST",
          form: {
            grant_type: "authorization_code",
            code: ctx.code,
            redirect_uri: ctx.redirectUri,
            client_id: clientId,
            client_secret: clientSecret,
          },
        },
      );
      const me = await fetchJson<{ sub: string; name?: string; picture?: string }>("https://api.linkedin.com/v2/userinfo", {
        bearer: t.access_token,
      });
      // No refresh token for this product: tokens last 60 days, then reconnect.
      return [
        {
          providerAccountId: me.sub,
          name: me.name || "LinkedIn",
          avatarUrl: me.picture,
          accessToken: t.access_token,
          expiresAt: secondsFromNow(t.expires_in),
        },
      ];
    },
  },

  async publish(acct, part) {
    const content = await buildContent(acct, part);
    const res = await request(`${REST}/posts`, {
      method: "POST",
      bearer: acct.accessToken,
      headers: HEADERS,
      json: {
        author: personUrn(acct),
        commentary: escapeLittleText(part.text),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        ...(content ? { content } : {}),
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      },
      final: true,
    });
    const urn = res.headers.get("x-restli-id");
    if (!urn) throw new NetworkError("LinkedIn accepted the post but returned no id");
    return { id: urn, url: `https://www.linkedin.com/feed/update/${urn}/` };
  },

  async firstComment(acct, post, text) {
    try {
      await request(`${REST}/socialActions/${encodeURIComponent(post.id)}/comments`, {
        method: "POST",
        bearer: acct.accessToken,
        headers: HEADERS,
        json: { actor: personUrn(acct), object: post.id, message: { text } },
      });
    } catch (err) {
      if (err instanceof NetworkError && err.status === 403) {
        throw new NetworkError(
          "LinkedIn refused the first comment: this app's scopes don't allow commenting. The post itself was published.",
          403,
        );
      }
      throw err;
    }
  },
};
