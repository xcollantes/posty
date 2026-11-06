import { cookies } from "next/headers";
import { getUser } from "@/lib/auth";
import { randomToken, sign } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { networks } from "@/lib/networks";
import type { NetworkId } from "@/lib/networks/catalog";
import { accountsRedirect, OAUTH_COOKIE, redirectUriFor } from "@/lib/oauth";
import { activeWorkspaceId } from "@/lib/workspaces";

/** Begin an OAuth connect: remember state + PKCE verifier, then redirect. */
export async function GET(request: Request, ctx: RouteContext<"/api/connect/[network]/start">) {
  if (!(await getUser())) return Response.redirect(new URL("/login", appUrl()).toString(), 303);
  const { network: id } = await ctx.params;
  const network = networks[id as NetworkId];
  if (!network || network.connect.kind !== "oauth") return new Response("Not found", { status: 404 });

  const input = Object.fromEntries(new URL(request.url).searchParams);
  const start = {
    state: randomToken(24),
    codeVerifier: randomToken(48),
    redirectUri: redirectUriFor(id),
    data: {},
  };
  try {
    const { url, data } = await network.connect.authorize(start, input);
    (await cookies()).set(
      OAUTH_COOKIE,
      sign(
        { state: start.state, verifier: start.codeVerifier, network: id, workspaceId: await activeWorkspaceId(), data: data ?? {} },
        600,
      ),
      {
        httpOnly: true,
        secure: appUrl().startsWith("https://"),
        sameSite: "lax", // must survive the top-level redirect back from the provider
        path: "/api/connect",
        maxAge: 600,
      },
    );
    return Response.redirect(url, 303);
  } catch (err) {
    return accountsRedirect({ error: (err as Error).message });
  }
}
