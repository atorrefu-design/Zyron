import { NextResponse } from "next/server";
import { buildCapabilityExecutionPlan } from "../../../../lib/capabilities/executor";
import { routeCapabilities } from "../../../../lib/capabilities/router";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as { message?: string };
  const message = body.message?.trim() || "";
  if (!message) {
    return NextResponse.json({ error: "Falta el mensaje." }, { status: 400 });
  }

  const routes = routeCapabilities(message);
  const primary = routes[0] ?? null;
  if (!primary) {
    return NextResponse.json({
      ok: true,
      primary: null,
      plan: null,
      alternatives: [],
    });
  }

  return NextResponse.json({
    ok: true,
    primary,
    plan: buildCapabilityExecutionPlan(primary),
    alternatives: routes.slice(1, 4).map((route) => ({
      route,
      plan: buildCapabilityExecutionPlan(route),
    })),
  });
}
