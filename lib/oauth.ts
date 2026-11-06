import { appUrl } from "@/lib/env";

export const OAUTH_COOKIE = "posty_oauth";

export type OAuthCookie = {
  state: string;
  verifier: string;
  network: string;
  /** Where the connect started, since the active workspace can change before the callback. */
  workspaceId: string;
  data: Record<string, string>;
};

export const redirectUriFor = (network: string) => `${appUrl()}/api/connect/${network}/callback`;

export function accountsRedirect(params: Record<string, string>) {
  const u = new URL("/accounts", appUrl());
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return Response.redirect(u.toString(), 303);
}
