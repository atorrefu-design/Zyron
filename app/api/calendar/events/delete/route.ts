import { NextRequest, NextResponse } from "next/server";
import { deleteCalendarEvent } from "../../../../../lib/google/calendar";
import { recordAction } from "../../../../../lib/db";

export const runtime = "nodejs";

type DeleteEventBody = {
  eventId?: string;
  title?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DeleteEventBody;
    const eventId = body.eventId?.trim();
    if (!eventId) {
      return NextResponse.json({ error: "Falta eventId." }, { status: 400 });
    }

    await deleteCalendarEvent(eventId);
    await recordAction("calendar", "calendar_event_deleted", `Eliminó el evento “${body.title?.trim() || eventId}”.`, {
      eventId,
      title: body.title?.trim() || null,
    }).catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "calendar_delete_failed";
    const missingScope = message.includes("403") || message.includes("insufficientPermissions");
    console.error("ZYRON_CALENDAR_DELETE_ERROR", error);
    return NextResponse.json(
      {
        error: missingScope
          ? "Google Calendar está conectado, pero falta autorizar la gestión de eventos."
          : "No se pudo eliminar el evento de Google Calendar.",
        code: missingScope ? "calendar_write_scope_missing" : "calendar_delete_failed",
      },
      { status: missingScope ? 403 : 502 },
    );
  }
}
