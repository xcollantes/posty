import { openAsBlob } from "node:fs";
import { decrypt, encrypt, pkceChallenge } from "@/lib/crypto";
import { getSetting, setSetting } from "@/lib/settings";
import { NETWORKS } from "./catalog";
import { fetchJson, NetworkError, pollUntil, request, url } from "./http";
import type { Network } from "./types";

// read:accounts (not `profile`) so instances older than 4.3 still work.
const SCOPES = "read:accounts read:statuses write:statuses write:media";

type AppCreds = { clientId: string; clientSecretEnc: string };

function normalizeInstance(input: string): string {
  const raw = input.trim().replace(/^@?[^@]+@/, ""); // accept user@host
  const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  if (u.protocol !== "https:") throw new NetworkError("Mastodon instance must use https");
  return u.origin;
}

/** Register (once per instance + redirect URI) the dynamic OAuth app. */
async function appFor(instance: string, redirectUri: string): Promise<{ clientId: string; clientSecret: string }> {
  const key = `mastodon:${instance}:${redirectUri}`;
  const saved = await getSetting<AppCreds>(key);
  if (saved) return { clientId: saved.clientId, clientSecret: decrypt(saved.clientSecretEnc) };
  const app = await fetchJson<{ client_id: string; client_secret: string }>(`${instance}/api/v1/apps`, {
    method: "POST",
    json: { client_name: "Posty", redirect_uris: redirectUri, scopes: SCOPES, website: "https://github.com" },
  });
  await setSetting(key, { clientId: app.client_id, clientSecretEnc: encrypt(app.client_secret) });
  return { clientId: app.client_id, clientSecret: app.client_secret };
}

type Status = { id: string; url: string; favourites_count?: number; reblogs_count?: number; replies_count?: number };

export const mastodon: Network = {
  id: "mastodon",
  info: NETWORKS.mastodon,
  connect: {
    kind: "oauth",
    preFields: [{ name: "instance", label: "Instance", placeholder: "mastodon.social" }],
    async authorize(ctx, input) {
      const instance = normalizeInstance(input.instance ?? "");
      const { clientId } = await appFor(instance, ctx.redirectUri);
      return {
        url: url(`${instance}/oauth/authorize`, {
          response_type: "code",
          client_id: clientId,
          redirect_uri: ctx.redirectUri,
          scope: SCOPES,
          state: ctx.state,
          code_challenge: pkceChallenge(ctx.codeVerifier),
          code_challenge_method: "S256",
          force_login: "true", // lets a 2nd account on the same instance sign in
        }),
        data: { instance },
      };
    },
    async exchange(ctx) {
      const instance = ctx.data.instance;
      const { clientId, clientSecret } = await appFor(instance, ctx.redirectUri);
      const token = await fetchJson<{ access_token: string }>(`${instance}/oauth/token`, {
        method: "POST",
        form: {
          grant_type: "authorization_code",
          code: ctx.code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: ctx.redirectUri,
          code_verifier: ctx.codeVerifier,
          scope: SCOPES,
        },
      });
      const me = await fetchJson<{ id: string; username: string; display_name: string; avatar: string }>(
        `${instance}/api/v1/accounts/verify_credentials`,
        { bearer: token.access_token },
      );
      type Instance = { configuration?: { statuses?: { max_characters?: number; max_media_attachments?: number } } };
      const info = await fetchJson<Instance>(`${instance}/api/v2/instance`).catch(() => ({}) as Instance);
      const host = new URL(instance).host;
      return [
        {
          providerAccountId: `${me.id}@${host}`,
          name: me.display_name || me.username,
          username: `@${me.username}@${host}`,
          avatarUrl: me.avatar,
          accessToken: token.access_token, // Mastodon tokens don't expire
          meta: {
            instance,
            statusId: me.id,
            maxChars: info.configuration?.statuses?.max_characters ?? 500,
            maxMedia: info.configuration?.statuses?.max_media_attachments ?? 4,
          },
        },
      ];
    },
  },

  async publish(acct, part, ctx) {
    const instance = String(acct.meta.instance);
    const mediaIds: string[] = [];
    for (const item of part.media) {
      const form = new FormData();
      form.append("file", await openAsBlob(item.path, { type: item.mime }), item.path.split("/").pop());
      if (item.altText) form.append("description", item.altText);
      const res = await request(`${instance}/api/v2/media`, {
        method: "POST",
        bearer: acct.accessToken,
        body: form,
        timeoutMs: 10 * 60_000,
      });
      const media = (await res.json()) as { id: string };
      if (res.status === 202) {
        // Still processing (video): poll until the attachment is ready.
        await pollUntil(async () => {
          const r = await request(`${instance}/api/v1/media/${media.id}`, { bearer: acct.accessToken });
          return r.status === 200 ? true : undefined;
        }, { what: "Mastodon media processing", retryable: true });
      }
      mediaIds.push(media.id);
    }
    const status = await fetchJson<Status>(`${instance}/api/v1/statuses`, {
      method: "POST",
      bearer: acct.accessToken,
      // Reason: retries with the same key return the original status, never a duplicate.
      headers: { "Idempotency-Key": ctx.idempotencyKey },
      json: {
        status: part.text,
        media_ids: mediaIds,
        visibility: ctx.options.visibility || "public",
        spoiler_text: ctx.options.spoiler || undefined,
        in_reply_to_id: ctx.replyTo?.parent.id,
      },
    });
    return { id: status.id, url: status.url };
  },

  async metrics(acct, id) {
    const s = await fetchJson<Status>(`${String(acct.meta.instance)}/api/v1/statuses/${id}`, { bearer: acct.accessToken });
    return { likes: s.favourites_count, shares: s.reblogs_count, comments: s.replies_count };
  },
};
