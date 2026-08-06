import { NextResponse } from "next/server";
import { getZyronTools } from "../../../lib/tools/registry";

export const runtime = "nodejs";

export async function GET() {
  const tools = Object.values(getZyronTools());
  const summary = tools.reduce(
    (acc, tool) => {
      acc[tool.status] += 1;
      return acc;
    },
    { available: 0, needs_configuration: 0, planned: 0 },
  );

  return NextResponse.json(
    {
      tools,
      count: tools.length,
      summary,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
