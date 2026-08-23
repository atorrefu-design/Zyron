import { NextResponse } from "next/server";
import { getAIProviderStatuses } from "../../../../lib/ai/router";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    routerMode: process.env.ZYRON_AI_ROUTER_MODE?.trim().toLowerCase() === "auto" ? "auto" : "manual",
    providers: getAIProviderStatuses(),
    copilot: {
      configured: false,
      status: "needs_microsoft_365_copilot_license",
      note: "Copilot se integrará mediante su API oficial cuando exista una licencia compatible.",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

