import { neon } from "@neondatabase/serverless";
import { listCalendarEvents } from "./google/calendar";
import { planDepartureForArrival } from "./google/routes";
import { buildCommuteBriefing } from "./commute-briefing";

const TIME_ZONE = "Europe/Madrid";
const HOUR = 60 * 60 * 1000;

type SavedOrigin = { latitude: number; longitude: number };

export type MobilityChatResult = {
  reply: string;
  action: "mobility_commute_read" | "mobility_calendar_read";
  tool: "maps";
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function formatClock(value: Date | string) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

function formatEventStart(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function asksMobility(message: string) {
  const clean = normalize(message);
  return /\b(trafico|ruta|trayecto|cuanto tardo|cuanto tardare|hora de salir|hora tengo que salir|cuando tengo que salir|cuando debo salir|a que hora salgo|a que hora tengo que salir|llego a tiempo|llegare a tiempo|salida recomendada)\b/.test(clean);
}

function asksNextEventTravel(message: string) {
  const clean = normalize(message);
  return /\b(proxima|proximo|siguiente)\b/.test(clean)
    && /\b(cita|reunion|evento|compromiso)\b/.test(clean)
    || /\bllego a tiempo\b/.test(clean)
    || /\bllegare a tiempo\b/.test(clean);
}

async function savedOrigin(): Promise<SavedOrigin | null> {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  try {
    const sql = neon(url);
    const rows = await sql`
      SELECT origin_lat, origin_lng
      FROM zyron_commute_profile
      WHERE id = 1 AND enabled = TRUE
      LIMIT 1
    `;
    const row = rows[0] as { origin_lat?: number; origin_lng?: number } | undefined;
    if (!row) return null;
    const latitude = Number(row.origin_lat);
    const longitude = Number(row.origin_lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}

async function nextCalendarTrip(now = new Date()): Promise<MobilityChatResult> {
  const events = await listCalendarEvents({
    timeMin: now,
    timeMax: new Date(now.getTime() + 24 * HOUR),
    maxResults: 20,
  });
  const next = events
    .filter((event) => !event.allDay && event.location?.trim() && new Date(event.start).getTime() > now.getTime())
    .filter((event) => !/meet\.google\.com|zoom\.|teams\.microsoft|videollamada|online|remoto|remote/i.test(event.location || ""))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];

  if (!next?.location) {
    return {
      reply: "No encuentro una próxima cita presencial con ubicación en Calendar durante las próximas 24 horas. Si el evento tiene dirección, añádela al campo de ubicación y podré calcular cuándo salir.",
      action: "mobility_calendar_read",
      tool: "maps",
    };
  }

  const origin = await savedOrigin();
  if (!origin) {
    return {
      reply: `Tu próxima cita presencial es “${next.title}” en ${next.location}, pero todavía no tengo un punto habitual de salida guardado. Abre Movilidad una vez y activa los avisos de ruta habitual para poder hacer este cálculo desde el chat.`,
      action: "mobility_calendar_read",
      tool: "maps",
    };
  }

  const start = new Date(next.start);
  const estimate = await planDepartureForArrival({
    origin,
    destination: { address: next.location },
    arrivalTime: start,
    bufferMinutes: 10,
  });
  const routeMinutes = Math.max(1, Math.round(estimate.durationSeconds / 60));
  const trafficMinutes = estimate.trafficDelaySeconds === null ? null : Math.max(0, Math.round(estimate.trafficDelaySeconds / 60));
  const leaveMinutes = Math.round(estimate.leaveInSeconds / 60);
  const trafficText = trafficMinutes === null ? "" : ` El tráfico añade unos ${trafficMinutes} min.`;
  const timing = leaveMinutes <= 0
    ? "Con 10 min de margen, conviene salir ya."
    : `Con 10 min de margen, te recomiendo salir a las ${formatClock(estimate.recommendedDepartureTime)}, dentro de unos ${leaveMinutes} min.`;

  return {
    reply: `Tu próxima cita presencial es “${next.title}” el ${formatEventStart(next.start)} en ${next.location}. El trayecto estimado desde tu punto habitual guardado es de ${routeMinutes} min.${trafficText} ${timing}`,
    action: "mobility_calendar_read",
    tool: "maps",
  };
}

async function habitualCommute(): Promise<MobilityChatResult> {
  const commute = await buildCommuteBriefing();
  if (commute.state === "planned") {
    const leaveInMinutes = commute.recommendedDepartureTime
      ? Math.round((new Date(commute.recommendedDepartureTime).getTime() - Date.now()) / 60000)
      : null;
    const extra = leaveInMinutes === null
      ? ""
      : leaveInMinutes <= 0
        ? " Conviene salir ya."
        : ` Quedan aproximadamente ${leaveInMinutes} min para esa salida.`;
    return { reply: `${commute.text}${extra}`, action: "mobility_commute_read", tool: "maps" };
  }

  return {
    reply: commute.text,
    action: "mobility_commute_read",
    tool: "maps",
  };
}

export async function handleMobilityChat(message: string): Promise<MobilityChatResult | null> {
  if (!asksMobility(message)) return null;
  if (asksNextEventTravel(message)) return nextCalendarTrip();
  return habitualCommute();
}
