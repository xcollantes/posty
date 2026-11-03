import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/media/", "/api/health", "/_next/", "/favicon.ico"];

/**
 * Optimistic auth gate. Real session checks happen in requireUser(); this
 * only bounces cookie-less requests to the login page.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Defense in depth: Funnel traffic may only ever reach /media/.
  if (request.headers.get("tailscale-funnel-request") && !pathname.startsWith("/media/")) {
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
  matcher: ["/((?!_next/static|_next/image).*)"],
};
