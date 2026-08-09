import { NextResponse } from "next/server";
import { zyronCapabilities } from "../../../lib/capabilities/registry";

export const runtime = "nodejs";

export async function GET() {
  const summary = zyronCapabilities.reduce(
    (acc, capability) => {
      acc.total += 1;
      acc[capability.status] += 1;
      return acc;
    },
    { total: 0, available: 0, partial: 0, planned: 0 },
  );

  return NextResponse.json(
    {
      ok: true,
      summary,
      capabilities: zyronCapabilities,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
