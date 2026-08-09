import { NextResponse } from "next/server";
import { routeCapabilities } from "../../../../lib/capabilities/router";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { message?: string } | null;
  const message = body?.message?.trim() ?? "";

  if (!message) {
    return NextResponse.json({ error: "Falta el mensaje." }, { status: 400 });
  }

  const routes = routeCapabilities(message);
  const primary = routes[0] ?? null;

  return NextResponse.json({
    ok: true,
    input: message,
    primary,
    alternatives: routes.slice(1, 4),
    needsFallback: primary?.fallbackOnly ?? false,
  });
}
