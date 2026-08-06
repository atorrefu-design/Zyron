import { NextResponse } from "next/server";
import { ZYRON_TOOLS } from "../../../lib/tools/registry";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      tools: Object.values(ZYRON_TOOLS),
      count: Object.keys(ZYRON_TOOLS).length,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
