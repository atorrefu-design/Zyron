import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { recordAction } from "../../../../lib/db";
import { handleMobilityChat } from "../../../../lib/chat-mobility";

export const runtime = "nodejs";

type ChatMessage = { role: "user" | "assistant"; content: string };
type DeviceLocation = { latitude?: number; longitude?: number; accuracy?: number; capturedAt?: string };
type RoutineUpdate = { arrivalTime?: string; destination?: string };

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function parseRoutineUpdate(message: string): RoutineUpdate | null {
  const clean = normalize(message);
  if (!/\b(trabajo|oficina|curro)\b/.test(clean)) return null;

  const explicitArrivalChange = /\b(quiero|prefiero|necesito|fija|pon|cambia|actualiza|guarda)\b/.test(clean)
    && /\b(llegar|llegada|hora)\b/.test(clean);
  const declaresArrival = /\b(mi hora habitual de llegada|mi hora de llegada)\b/.test(clean);
  const timeMatch = clean.match(/\b(?:a|para)\s+las?\s+([01]?\d|2[0-3])[:.]([0-5]\d)\b/);

  let arrivalTime: string | undefined;
  if ((explicitArrivalChange || declaresArrival) && timeMatch) {
    arrivalTime = `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2]}`;
  }

  const original = message.replace(/\s+/g, " ").trim();
  const addressPatterns = [
    /\bmi\s+(?:trabajo|oficina|curro)\s+(?:está|esta)\s+en\s+(.+?)(?=\s+y\s+(?:quiero|prefiero|necesito|mi\s+hora)|$)/i,
    /\bla\s+direcci[oó]n\s+de\s+mi\s+(?:trabajo|oficina|curro)\s+es\s+(.+?)(?=\s+y\s+(?:quiero|prefiero|necesito|mi\s+hora)|$)/i,
    /\b(?:cambia|actualiza|corrige|guarda)\s+(?:la\s+)?direcci[oó]n\s+de\s+(?:mi\s+)?(?:trabajo|oficina|curro)\s+(?:a|por)\s+(.+?)(?=\s+y\s+(?:quiero|prefiero|necesito|mi\s+hora)|$)/i,
  ];

  let destination: string | undefined;
  for (const pattern of addressPatterns) {
    const match = original.match(pattern);
    const candidate = match?.[1]?.trim().replace(/[.!?]+$/, "");
    if (candidate && candidate.length <= 300) {
      destination = candidate;
      break;
    }
  }

  if (!arrivalTime && !destination) return null;
  return { arrivalTime, destination };
}

async function updateRoutine(update: RoutineUpdate, currentLocation?: { latitude: number; longitude: number }) {
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error("commute_database_not_configured");
  const sql = neon(databaseUrl);

  const rows = await sql`
    SELECT origin_lat, origin_lng, destination, arrival_time, buffer_minutes, weekdays, enabled
    FROM zyron_commute_profile
    WHERE id = 1
    LIMIT 1
  `;
  const row = rows[0] as {
    origin_lat?: number;
    origin_lng?: number;
    destination?: string;
    arrival_time?: string;
    buffer_minutes?: number;
    weekdays?: string;
    enabled?: boolean;
  } | undefined;

  if (!row) {
    if (!currentLocation || !update.destination || !update.arrivalTime) {
      return {
        reply: "Todavía no hay una ruta habitual guardada. Abre Movilidad una vez para fijar el punto de salida, o dime en una sola frase la dirección del trabajo y la hora a la que quieres llegar mientras compartes tu ubicación.",
        action: "mobility_routine_missing",
        tool: "maps" as const,
      };
    }
    await sql`
      INSERT INTO zyron_commute_profile (
        id, origin_lat, origin_lng, destination, arrival_time, buffer_minutes, weekdays, enabled, updated_at
      ) VALUES (
        1, ${currentLocation.latitude}, ${currentLocation.longitude}, ${update.destination}, ${update.arrivalTime}, 10, '1,2,3,4,5', TRUE, NOW()
      )
    `;
  } else {
    const destination = update.destination || String(row.destination || "").trim();
    const arrivalTime = update.arrivalTime || String(row.arrival_time || "").trim();
    if (!destination || !/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)) throw new Error("commute_profile_invalid");
    await sql`
      UPDATE zyron_commute_profile
      SET destination = ${destination}, arrival_time = ${arrivalTime}, enabled = TRUE, updated_at = NOW()
      WHERE id = 1
    `;
  }

  const confirmation = [
    update.destination ? `destino habitual: ${update.destination}` : null,
    update.arrivalTime ? `hora habitual de llegada: ${update.arrivalTime}` : null,
  ].filter(Boolean).join(" · ");

  return {
    reply: `He actualizado tu rutina de movilidad. ${confirmation}. A partir de ahora usaré estos datos en tráfico, briefing y avisos de salida.`,
    action: "mobility_routine_updated",
    tool: "maps" as const,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: ChatMessage[]; deviceLocation?: DeviceLocation };
    const messages = (body.messages ?? []).filter(
      (message): message is ChatMessage =>
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
    );
    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content?.trim();
    if (!lastUserMessage) return NextResponse.json({ error: "Falta el mensaje del usuario" }, { status: 400 });

    const latitude = body.deviceLocation?.latitude;
    const longitude = body.deviceLocation?.longitude;
    const currentLocation = validCoordinate(latitude, -90, 90) && validCoordinate(longitude, -180, 180)
      ? { latitude, longitude }
      : undefined;

    const routineUpdate = parseRoutineUpdate(lastUserMessage);
    if (routineUpdate) {
      const result = await updateRoutine(routineUpdate, currentLocation);
      void recordAction("maps", result.action, "Actualizó su rutina de movilidad desde el chat.", {
        source: "chat",
        changedDestination: Boolean(routineUpdate.destination),
        changedArrivalTime: Boolean(routineUpdate.arrivalTime),
      }).catch(() => undefined);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await handleMobilityChat(lastUserMessage, { currentLocation });
    if (!result) {
      return NextResponse.json({ error: "mobility_intent_not_detected" }, { status: 400 });
    }

    void recordAction("maps", result.action, "Consultó movilidad desde el chat.", {
      source: "chat",
      locationMode: currentLocation ? "current_transient" : "saved_or_unavailable",
    }).catch(() => undefined);

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ZYRON_MOBILITY_CHAT_ERROR", error);
    return NextResponse.json({
      reply: "No he podido calcular la movilidad ahora mismo. Prueba de nuevo en unos segundos o abre Movilidad para revisar la ruta.",
      action: "mobility_read_failed",
      tool: "maps",
    });
  }
}
