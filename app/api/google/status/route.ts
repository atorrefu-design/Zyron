import { NextResponse } from "next/server";
import { getGoogleConnection, googleOAuthConfigured } from "../../../../lib/google/oauth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const configured = googleOAuthConfigured();
    const connection = configured ? await getGoogleConnection() : null;
    return NextResponse.json(
      {
        configured,
        connected: Boolean(connection),
        email: connection?.email ?? null,
        scope: connection?.scope ?? null,
        updatedAt: connection?.updated_at ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("ZYRON_GOOGLE_STATUS_ERROR", error);
    return NextResponse.json({ configured: googleOAuthConfigured(), connected: false, error: "status_unavailable" }, { status: 500 });
  }
}
