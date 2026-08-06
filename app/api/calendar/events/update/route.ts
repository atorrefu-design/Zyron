import { NextRequest, NextResponse } from "next/server";
import { updateCalendarEvent } from "../../../../../lib/google/calendar";
import { recordAction } from "../../../../../lib/db";

export const runtime = "nodejs";

type UpdateEventBody = {
  eventId?: string;
  title?: string;
  start?: string;
  end?: string;
  location?: string | null;
  description?: string | null;
  timeZone?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UpdateEventBody;
    const eventId = body.eventId?.trim();
    const title = body.title?.trim();
    const start = body.start?.trim();
    const end = body.end?.trim();
    if (!eventId || !title || !start || !end) {
      return NextResponse.json({ error: "Faltan eventId, title, start o end." }, { status: 400 });
    }

    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      return NextResponse.json({ error: "La fecha de inicio o fin no es válida." }, { status: 400 });
    }

    const event = await updateCalendarEvent(eventId, {
      title,
      start,
      end,
      location: body.location,
      description: body.description,
      timeZone: body.timeZone || "Europe/Madrid",
    });

    await recordAction("calendar", "calendar_event_updated", `Actualizó el evento “${event.title}”.`, {
      eventId: event.id,
      start: event.start,
      end: event.end,
      location: event.location,
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, event });
  } catch (error) {
    const message = error instanceof Error ? error.message : "calendar_update_failed";
    const missingScope = message.includes("403") || message.includes("insufficientPermissions");
    console.error("ZYRON_CALENDAR_UPDATE_ERROR", error);
    return NextResponse.json(
      {
        error: missingScope
          ? "Google Calendar está conectado, pero falta autorizar la edición de eventos."
          : "No se pudo actualizar el evento en Google Calendar.",
        code: missingScope ? "calendar_write_scope_missing" : "calendar_update_failed",
      },
      { status: missingScope ? 403 : 502 },
    );
  }
}
