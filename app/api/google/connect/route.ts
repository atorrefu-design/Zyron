import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthorizationUrl, createOAuthState, googleOAuthConfigured } from "../../../../lib/google/oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!googleOAuthConfigured()) {
    return NextResponse.json(
      { error: "Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o ZYRON_AUTH_SECRET." },
      { status: 503 },
    );
  }

  const state = createOAuthState();
  const origin = new URL(request.url).origin;
  const response = NextResponse.redirect(buildGoogleAuthorizationUrl(origin, state));
  response.cookies.set("zyron_google_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
