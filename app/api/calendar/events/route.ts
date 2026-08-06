import { NextRequest, NextResponse } from "next/server";
import { listCalendarEvents } from "../../../../lib/google/calendar";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 7), 1), 31);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 100);
  const timeMin = new Date();
  const timeMax = new Date(timeMin.getTime() + days * 24 * 60 * 60 * 1000);

  try {
    const events = await listCalendarEvents({ timeMin, timeMax, maxResults: limit });
    return NextResponse.json(
      { connected: true, events, range: { from: timeMin.toISOString(), to: timeMax.toISOString() } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "calendar_unknown_error";
    const missingScope = message.includes("403") || message.includes("insufficientPermissions");
    return NextResponse.json(
      {
        connected: true,
        events: [],
        error: missingScope ? "Google Calendar está conectado, pero falta autorizar el permiso de lectura del calendario." : "No se pudieron leer los eventos de Google Calendar.",
        code: missingScope ? "calendar_scope_missing" : "calendar_read_failed",
      },
      { status: missingScope ? 403 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
