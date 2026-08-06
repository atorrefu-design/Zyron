import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerSession } from "./lib/auth";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/favicon.ico"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const token = request.cookies.get("zyron_owner_session")?.value;
  const authenticated = await verifyOwnerSession(token);

  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|robots.txt|sitemap.xml|manifest.webmanifest|icon.svg).*)"],
};
