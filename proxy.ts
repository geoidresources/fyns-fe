import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next 16's renamed middleware (was middleware.ts). Gates the app shell on the
// presence of the auth token cookie set by lib/auth.setSession, so an
// unauthenticated deep-link to /globe or /viewer/* bounces to sign-in instead
// of flashing a broken, token-less page. This is a coarse presence check only —
// the API still validates the JWT on every request; do not treat it as
// authorization. Do NOT set a `runtime` config here: proxy is Node.js-only and
// setting runtime throws.

const PROTECTED = ["/globe", "/viewer", "/upload"];
const AUTH_ROUTES = ["/sign-in", "/sign-up"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasToken = Boolean(request.cookies.get("token")?.value);

  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAuthRoute = AUTH_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isProtected && !hasToken) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  // Already signed in — keep the auth pages from re-prompting.
  if (isAuthRoute && hasToken) {
    const url = request.nextUrl.clone();
    url.pathname = "/globe";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/globe", "/viewer/:path*", "/upload", "/sign-in", "/sign-up"],
};
