import { NextResponse, type NextRequest } from "next/server";

/**
 * Framing policy. Everything is unframeable except /embed/*, which may be framed only
 * by the `parent` origin named in its URL. The embed page separately checks that
 * origin against the merchant's allow-list, so both checks must pass.
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  let ancestors = "'none'";
  if (request.nextUrl.pathname.startsWith("/embed/")) {
    try {
      const parent = new URL(request.nextUrl.searchParams.get("parent") ?? "");
      const local = parent.hostname === "localhost" || parent.hostname === "127.0.0.1";
      if (parent.protocol === "https:" || (parent.protocol === "http:" && local)) ancestors = parent.origin;
    } catch {
      ancestors = "'none'";
    }
  }
  response.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  if (ancestors === "'none'") response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
