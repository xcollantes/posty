import { NextResponse, type NextRequest } from "next/server";

// /api/mcp checks its own bearer token.
const PUBLIC_PREFIXES = ["/login", "/media/", "/api/health", "/api/mcp", "/_next/", "/favicon.ico", "/icon"];

/**
 * Optimistic auth gate. Real session checks happen in requireUser(); this
 * only bounces cookie-less requests to the login page.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Funnel opens the whole host to the internet, so this is the boundary:
  // public traffic may only reach media files and the token-checked MCP.
  const funnelOk = pathname.startsWith("/media/") || pathname === "/api/mcp";
  if (request.headers.get("tailscale-funnel-request") && !funnelOk) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!request.cookies.has("posty_session")) {
    // Reason: behind `tailscale serve` the inner request is plain http.
    const url = new URL("/login", process.env.APP_URL || request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Reason: Next buffers proxied bodies and silently cuts them off at 10 MB,
  // so uploads must skip the proxy. The route repeats the Funnel rule above.
  matcher: ["/((?!_next/static|_next/image|api/media$).*)"],
};
