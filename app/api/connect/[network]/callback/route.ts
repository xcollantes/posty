import { cookies } from "next/headers";
import { saveConnected } from "@/lib/accounts";
import { getUser } from "@/lib/auth";
import { unsign } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { networks } from "@/lib/networks";
import type { NetworkId } from "@/lib/networks/catalog";
import { accountsRedirect, OAUTH_COOKIE, redirectUriFor, type OAuthCookie } from "@/lib/oauth";

export async function GET(request: Request, ctx: RouteContext<"/api/connect/[network]/callback">) {
  if (!(await getUser())) return Response.redirect(new URL("/login", appUrl()).toString(), 303);
  const { network: id } = await ctx.params;
  const network = networks[id as NetworkId];
  if (!network || network.connect.kind !== "oauth") return new Response("Not found", { status: 404 });

  const params = new URL(request.url).searchParams;
  const jar = await cookies();
  const saved = unsign<OAuthCookie>(jar.get(OAUTH_COOKIE)?.value);
  jar.delete({ name: OAUTH_COOKIE, path: "/api/connect" });

  const providerError = params.get("error_description") ?? params.get("error");
  if (providerError) return accountsRedirect({ error: `${network.info.label}: ${providerError}` });
  if (!saved || saved.network !== id || saved.state !== params.get("state")) {
    return accountsRedirect({ error: "Connection expired or state mismatch, please try again." });
  }
  const code = params.get("code")?.replace(/#_$/, "");
  if (!code) return accountsRedirect({ error: `${network.info.label}: no authorization code returned` });

  try {
    const accounts = await network.connect.exchange({
      code,
      state: saved.state,
      codeVerifier: saved.verifier,
      redirectUri: redirectUriFor(id),
      data: saved.data,
    });
    if (!accounts.length) return accountsRedirect({ error: `${network.info.label}: no accounts were granted` });
    await saveConnected(id, accounts);
    return accountsRedirect({ connected: String(accounts.length) });
  } catch (err) {
    return accountsRedirect({ error: `${network.info.label}: ${(err as Error).message}` });
  }
}
