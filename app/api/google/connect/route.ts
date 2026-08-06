import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthorizationUrl, createOAuthState } from "../../../../lib/google/oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const missing = [
    ["GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID],
    ["GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET],
    ["ZYRON_AUTH_SECRET", process.env.ZYRON_AUTH_SECRET],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    return NextResponse.json(
      {
        error: "Faltan variables de entorno para Google OAuth.",
        missing,
        deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? null,
      },
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
