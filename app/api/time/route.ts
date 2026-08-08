import { NextResponse } from "next/server";

export const runtime = "nodejs";

const TIME_ZONE = "Europe/Madrid";

export async function POST() {
  const now = new Date();
  const time = new Intl.DateTimeFormat("es-ES", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const date = new Intl.DateTimeFormat("es-ES", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  return NextResponse.json({
    reply: `Son las ${time}. Hoy es ${date}.`,
    action: "time_read",
    tool: "system",
  }, { headers: { "Cache-Control": "no-store" } });
}
