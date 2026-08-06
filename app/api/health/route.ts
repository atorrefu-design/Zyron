import { NextResponse } from "next/server";
import { getZyronHealth } from "../../../lib/health";

export const runtime = "nodejs";

export async function GET() {
  const health = await getZyronHealth();
  return NextResponse.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
