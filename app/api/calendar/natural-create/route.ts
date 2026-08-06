import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { createCalendarEvent } from "../../../../lib/google/calendar";
import { recordAction } from "../../../../lib/db";

export const runtime = "nodejs";

const TIME_ZONE = "Europe/Madrid";

type ParsedEvent = {
  title: string;
  start: string;
  end: string;
  location?: string | null;
};

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
}

function localDateKey(offsetDays: number) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays, 12));
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

function deterministicParse(message: string): ParsedEvent | null {
  const clean = message.trim();
  const normalized = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!/\b(anade|añade|crea|apunta|agenda|programa)\b/.test(normalized)) return null;

  const dayOffset = /\bmanana\b/.test(normalized) ? 1 : /\bhoy\b/.test(normalized) ? 0 : null;
  const timeMatch = normalized.match(/\b(?:a\s+las?\s+)?(\d{1,2})(?::|\.)(\d{2})\b|\b(?:a\s+las?\s+)(\d{1,2})\b/);
  if (dayOffset === null || !timeMatch) return null;

  const hour = Number(timeMatch[1] ?? timeMatch[3]);
  const minute = Number(timeMatch[2] ?? 0);
  if (hour > 23 || minute > 59) return null;

  const date = localDateKey(dayOffset);
  const start = `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+02:00`;
  const endDate = new Date(new Date(start).getTime() + 60 * 60 * 1000);
  const end = endDate.toISOString();

  const title = clean
    .replace(/^(añade|anade|crea|apunta|agenda|programa)(?:me)?\s+/i, "")
    .replace(/\b(hoy|mañana|manana)\b/gi, "")
    .replace(/\b(?:a\s+las?\s+)?\d{1,2}(?::|\.)?\d{0,2}\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "")
    .trim();

  if (!title) return null;
  return { title, start, end };
}

async function aiParse(message: string): Promise<ParsedEvent | null> {
  const openai = getOpenAI();
  if (!openai) return null;
  const now = new Date().toISOString();
  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions: [
        "Extrae una petición para crear un evento de calendario.",
        `Fecha y hora actuales: ${now}. Zona horaria: ${TIME_ZONE}.`,
        "Devuelve solo JSON válido: {\"title\":string,\"start\":ISO8601,\"end\":ISO8601,\"location\":string|null}.",
        "Si falta fecha u hora, devuelve null.",
        "Si no se indica duración, usa 60 minutos.",
      ].join("\n"),
      input: message,
    });
    const text = response.output_text.trim();
    if (text === "null") return null;
    const parsed = JSON.parse(text) as ParsedEvent;
    if (!parsed.title || !parsed.start || !parsed.end) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { message?: string };
    const message = body.message?.trim();
    if (!message) return NextResponse.json({ error: "Falta el mensaje." }, { status: 400 });

    const parsed = deterministicParse(message) ?? await aiParse(message);
    if (!parsed) {
      return NextResponse.json({
        reply: "Necesito una fecha y una hora concretas. Por ejemplo: “Añade dentista mañana a las 18:00”.",
        action: "calendar_create_needs_details",
        tool: "calendar",
      });
    }

    const event = await createCalendarEvent({
      title: parsed.title,
      start: parsed.start,
      end: parsed.end,
      location: parsed.location,
      timeZone: TIME_ZONE,
    });

    await recordAction("calendar", "calendar_event_created", `Creó el evento “${event.title}” desde lenguaje natural.`, {
      eventId: event.id,
      start: event.start,
      end: event.end,
    }).catch(() => undefined);

    const when = new Intl.DateTimeFormat("es-ES", {
      timeZone: TIME_ZONE,
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(event.start));

    return NextResponse.json({
      reply: `He creado “${event.title}” para ${when}.`,
      action: "calendar_event_created",
      tool: "calendar",
      event,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "calendar_create_failed";
    const missingScope = message.includes("403") || message.includes("insufficientPermissions");
    console.error("ZYRON_NATURAL_CALENDAR_CREATE_ERROR", error);
    return NextResponse.json({
      error: missingScope
        ? "Falta autorizar a ZYRON para crear eventos. Vuelve a conectar Google Calendar desde /api/google/connect."
        : "No se pudo crear el evento en Google Calendar.",
    }, { status: missingScope ? 403 : 502 });
  }
}
