import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
  type ZyronCalendarEvent,
} from "../../../../lib/google/calendar";
import { recordAction } from "../../../../lib/db";

export const runtime = "nodejs";

const TIME_ZONE = "Europe/Madrid";

type CalendarCommand = {
  action: "create" | "update" | "delete" | "none";
  title?: string;
  target?: string;
  start?: string;
  end?: string;
  location?: string | null;
  description?: string | null;
  confirmation?: boolean;
};

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
}

function formatEvent(event: ZyronCalendarEvent) {
  const when = event.allDay
    ? event.start
    : new Intl.DateTimeFormat("es-ES", {
        timeZone: TIME_ZONE,
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(event.start));
  return `${when} · ${event.title}${event.location ? ` · ${event.location}` : ""}`;
}

async function parseCommand(message: string): Promise<CalendarCommand> {
  const openai = getOpenAI();
  if (!openai) return { action: "none" };
  const now = new Date().toISOString();
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    instructions: [
      "Interpreta una orden en castellano de España para Google Calendar.",
      `Fecha y hora actuales: ${now}. Zona horaria: ${TIME_ZONE}.`,
      "Devuelve exclusivamente JSON válido.",
      "Formato: {\"action\":\"create|update|delete|none\",\"title\":\"\",\"target\":\"\",\"start\":\"ISO\",\"end\":\"ISO\",\"location\":null,\"description\":null,\"confirmation\":false}.",
      "create requiere title, start y end. Si no se indica duración, usa 60 minutos.",
      "update usa target para identificar el evento y solo incluye los campos que cambian.",
      "delete usa target para identificar el evento.",
      "confirmation solo es true cuando el usuario confirma explícitamente una propuesta anterior.",
      "No inventes fecha ni hora si el usuario no las ha indicado con suficiente claridad.",
    ].join("\n"),
    input: message,
  });
  try {
    return JSON.parse(response.output_text.trim()) as CalendarCommand;
  } catch {
    return { action: "none" };
  }
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matchEvents(target: string, events: ZyronCalendarEvent[]) {
  const needle = normalize(target);
  return events.filter((event) => normalize(event.title).includes(needle) || needle.includes(normalize(event.title)));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { message?: string; eventId?: string; confirmation?: boolean };
    const message = body.message?.trim();
    if (!message) return NextResponse.json({ error: "Falta el mensaje." }, { status: 400 });

    const command = await parseCommand(message);
    if (command.action === "none") {
      return NextResponse.json({
        action: "none",
        reply: "No he podido identificar una orden completa de calendario. Indica qué quieres hacer, el evento y la fecha u hora necesarias.",
      });
    }

    if (command.action === "create") {
      if (!command.title || !command.start || !command.end) {
        return NextResponse.json({
          action: "needs_details",
          reply: "Necesito el título, la fecha y la hora para crear el evento.",
          command,
        });
      }
      const event = await createCalendarEvent({
        title: command.title,
        start: command.start,
        end: command.end,
        location: command.location,
        description: command.description,
        timeZone: TIME_ZONE,
      });
      await recordAction("calendar", "calendar_event_created", `Creó el evento “${event.title}” desde el chat.`, {
        eventId: event.id,
        start: event.start,
        end: event.end,
      }).catch(() => undefined);
      return NextResponse.json({ action: "created", event, reply: `He creado “${event.title}” en Google Calendar: ${formatEvent(event)}.` });
    }

    const now = new Date();
    const events = await listCalendarEvents({
      timeMin: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      timeMax: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000),
      maxResults: 100,
    });
    const target = command.target?.trim() || "";
    const matches = body.eventId ? events.filter((event) => event.id === body.eventId) : matchEvents(target, events);

    if (matches.length === 0) {
      return NextResponse.json({ action: "not_found", reply: `No encuentro ningún evento que encaje con “${target}”.` });
    }
    if (matches.length > 1 && !body.eventId) {
      return NextResponse.json({
        action: "ambiguous",
        reply: `He encontrado varios eventos parecidos. Elige uno antes de continuar:\n${matches.slice(0, 8).map((event, index) => `${index + 1}. ${formatEvent(event)}`).join("\n")}`,
        events: matches.slice(0, 8),
      });
    }

    const selected = matches[0];
    const confirmed = Boolean(body.confirmation || command.confirmation);
    if (!confirmed) {
      const verb = command.action === "delete" ? "eliminar" : "modificar";
      return NextResponse.json({
        action: "confirmation_required",
        reply: `Confirma que quieres ${verb} este evento: ${formatEvent(selected)}.`,
        event: selected,
        command,
      });
    }

    if (command.action === "delete") {
      await deleteCalendarEvent(selected.id);
      await recordAction("calendar", "calendar_event_deleted", `Eliminó el evento “${selected.title}” desde el chat.`, { eventId: selected.id }).catch(() => undefined);
      return NextResponse.json({ action: "deleted", reply: `He eliminado “${selected.title}” de Google Calendar.` });
    }

    const event = await updateCalendarEvent(selected.id, {
      title: command.title || selected.title,
      start: command.start || selected.start,
      end: command.end || selected.end,
      location: command.location === undefined ? selected.location : command.location,
      description: command.description,
      timeZone: TIME_ZONE,
    });
    await recordAction("calendar", "calendar_event_updated", `Actualizó el evento “${event.title}” desde el chat.`, {
      eventId: event.id,
      start: event.start,
      end: event.end,
    }).catch(() => undefined);
    return NextResponse.json({ action: "updated", event, reply: `He actualizado “${event.title}”: ${formatEvent(event)}.` });
  } catch (error) {
    console.error("ZYRON_CALENDAR_COMMAND_ERROR", error);
    const message = error instanceof Error ? error.message : "calendar_command_failed";
    const missingScope = message.includes("403") || message.includes("insufficientPermissions");
    return NextResponse.json(
      {
        error: missingScope
          ? "Falta autorizar el permiso para gestionar eventos de Google Calendar."
          : "No he podido ejecutar la orden de calendario.",
        code: missingScope ? "calendar_write_scope_missing" : "calendar_command_failed",
      },
      { status: missingScope ? 403 : 500 },
    );
  }
}
