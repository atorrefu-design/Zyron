import { NextRequest, NextResponse } from "next/server";
import { createCalendarEvent } from "../../../../../lib/google/calendar";
import { recordAction } from "../../../../../lib/db";

export const runtime = "nodejs";

type CreateEventBody = {
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  timeZone?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateEventBody;
    const title = body.title?.trim();
    const start = body.start?.trim();
    const end = body.end?.trim();

    if (!title || !start || !end) {
      return NextResponse.json(
        { error: "Faltan title, start o end." },
        { status: 400 },
      );
    }

    if (!body.allDay) {
      const startTime = new Date(start).getTime();
      const endTime = new Date(end).getTime();
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
        return NextResponse.json(
          { error: "La fecha de inicio o fin no es válida." },
          { status: 400 },
        );
      }
    }

    const event = await createCalendarEvent({
      title,
      start,
      end,
      allDay: body.allDay,
      location: body.location,
      description: body.description,
      timeZone: body.timeZone || "Europe/Madrid",
    });

    await recordAction("calendar", "calendar_event_created", `Creó el evento “${event.title}”.`, {
      eventId: event.id,
      start: event.start,
      end: event.end,
      location: event.location,
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, event }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "calendar_create_failed";
    const missingScope = message.includes("403") || message.includes("insufficientPermissions");
    console.error("ZYRON_CALENDAR_CREATE_ERROR", error);
    return NextResponse.json(
      {
        error: missingScope
          ? "Google Calendar está conectado, pero falta autorizar la creación de eventos."
          : "No se pudo crear el evento en Google Calendar.",
        code: missingScope ? "calendar_write_scope_missing" : "calendar_create_failed",
      },
      { status: missingScope ? 403 : 502 },
    );
  }
}
