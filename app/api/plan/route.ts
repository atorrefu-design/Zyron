import { NextResponse } from "next/server";
import { buildDailyPlan, formatDailyPlan } from "../../../lib/tools/planner";

export const runtime = "nodejs";

export async function GET() {
  try {
    const plan = await buildDailyPlan();
    return NextResponse.json(
      { plan, reply: formatDailyPlan(plan), tool: "planner", action: "daily_plan_created" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("ZYRON_PLAN_ERROR", error);
    return NextResponse.json({ error: "No he podido preparar el plan del día." }, { status: 500 });
  }
}
