// Local-only guard (PRD §8.2): accept loopback Host headers only, and require a
// same-origin Origin on every state-changing request so a page on another site
// cannot drive this server from the user's browser.

import { NextResponse, type NextRequest } from "next/server";

const port = process.env.PORT ?? "3210";
const allowedHosts = new Set([
  `127.0.0.1:${port}`,
  `localhost:${port}`,
  `[::1]:${port}`,
  ...(process.env.PEW_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean),
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!allowedHosts.has(host)) {
    return new NextResponse("Host not allowed", { status: 421 });
  }
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    let originHost: string | null = null;
    try {
      originHost = origin ? new URL(origin).host : null;
    } catch {
      originHost = null;
    }
    if (originHost !== host) {
      return NextResponse.json({ code: "forbidden", message: "cross-origin request rejected", retryable: false, details: {} }, { status: 403 });
    }
  }
  const path = request.nextUrl.pathname;
  if (!PUBLIC_PATHS.includes(path) && !request.cookies.has("pew_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
