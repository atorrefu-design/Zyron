import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, verifyOAuthState } from "../../../../lib/google/oauth";
import { recordAction } from "../../../../lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get("zyron_google_oauth_state")?.value;

  if (!code || !state || !cookieState || state !== cookieState || !verifyOAuthState(state)) {
    return NextResponse.redirect(new URL("/dashboard?google=invalid_state", request.url));
  }

  try {
    const connection = await exchangeCode(url.origin, code);
    await recordAction("calendar", "google_connected", "Conectó Google Calendar con ZYRON.", {
      email: connection.email,
      scope: connection.scope,
    }).catch(() => undefined);

    const response = NextResponse.redirect(new URL("/dashboard?google=connected", request.url));
    response.cookies.delete("zyron_google_oauth_state");
    return response;
  } catch (error) {
    console.error("ZYRON_GOOGLE_CALLBACK_ERROR", error);
    return NextResponse.redirect(new URL("/dashboard?google=connection_failed", request.url));
  }
}
