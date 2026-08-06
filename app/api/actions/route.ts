import { NextRequest, NextResponse } from "next/server";
import { listActions } from "../../../lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get("limit") || "50");
  const limit = Number.isFinite(requested) ? requested : 50;
  const actions = await listActions(limit);

  return NextResponse.json(
    { actions, count: actions.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
