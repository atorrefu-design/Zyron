import { NextResponse } from "next/server";
import { listActions } from "../../../lib/db";
import { getHealthSnapshot } from "../../../lib/health";
import { buildDailyPlan, formatDailyPlan } from "../../../lib/tools/planner";
import { getZyronTools } from "../../../lib/tools/registry";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [plan, health, recentActions] = await Promise.all([
      buildDailyPlan(),
      getHealthSnapshot(),
      listActions(5),
    ]);

    const tools = getZyronTools();
    const missingContext = [
      tools.calendar.status !== "available" ? "agenda" : null,
      tools.maps.status !== "available" ? "tráfico y desplazamientos" : null,
      tools.gmail.status !== "available" ? "correo" : null,
    ].filter((item): item is string => Boolean(item));

    const limitations = missingContext.length
      ? `Todavía no puedo incorporar ${missingContext.join(", ")} porque esas conexiones no están activas.`
      : "Todas las fuentes previstas para el briefing están disponibles.";

    const reply = [
      "Briefing de ZYRON",
      "",
      formatDailyPlan(plan),
      "",
      health.ok ? "El núcleo está operativo." : "Hay algún servicio del núcleo que requiere revisión.",
      limitations,
    ].join("\n");

    return NextResponse.json(
      {
        reply,
        generatedAt: new Date().toISOString(),
        plan,
        health,
        recentActions,
        limitations: missingContext,
        tool: "planner",
        action: "owner_briefing_created",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("ZYRON_BRIEFING_ERROR", error);
    return NextResponse.json({ error: "No he podido preparar el briefing." }, { status: 500 });
  }
}
