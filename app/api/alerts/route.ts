import { NextResponse } from "next/server";
import { buildProactiveAlerts } from "../../../lib/proactive";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await buildProactiveAlerts();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ZYRON_PROACTIVE_ALERTS_ERROR", error);
    return NextResponse.json(
      { error: "No he podido preparar los avisos proactivos." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
