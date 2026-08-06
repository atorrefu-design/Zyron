import { NextResponse } from "next/server";
import { unavailableCapabilityReply } from "../../../../lib/tools/capability-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { message?: string };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ error: "Falta el mensaje" }, { status: 400 });
    }

    const blocked = unavailableCapabilityReply(message);
    return NextResponse.json(
      blocked ?? { available: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "No se pudo comprobar la capacidad" }, { status: 500 });
  }
}
