import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (pathname === "/api/chat" && searchParams.get("zyron_internal") !== "1") {
    const url = request.nextUrl.clone();
    url.pathname = "/api/chat-orchestrated";
    url.search = "";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/chat"],
};
