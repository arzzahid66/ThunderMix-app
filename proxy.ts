import { NextResponse, type NextRequest } from "next/server";

const secure = process.env.NODE_ENV === "production";
const ADMIN_COOKIE = secure ? "__Host-tp_admin" : "tp_admin";
const VISITOR_COOKIE = secure ? "__Host-tp_visitor" : "tp_visitor";

/**
 * Cheap first gate based on cookie presence only. Tokens are verified by the
 * database in the admin layout / terminal page and in every API route.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login" && !request.cookies.has(ADMIN_COOKIE)) {
    const url = new URL("/admin/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/terminal") && !request.cookies.has(VISITOR_COOKIE)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/terminal/:path*", "/admin/:path*"],
};
