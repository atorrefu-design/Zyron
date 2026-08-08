import { neon } from "@neondatabase/serverless";
import { planDepartureForArrival } from "./google/routes";

const MAX_EVENT_LOOKAHEAD_MS = 2 * 60 * 60 * 1000;

type CalendarEventLike = {
  id: string;
  title: string;
  start: string;
  location?: string | null;
  allDay?: boolean;
};

type SavedOrigin = {
  latitude: number;
  longitude: number;
};

export type CalendarTravelAlert = {
  id: string;
  severity: "alta" | "media";
  title: string;
  detail: string;
  suggestedAction: string;
  eventAt: string;
};

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function looksRemote(location: string) {
  return /meet\.google\.com|zoom\.|teams\.microsoft|videollamada|online|remoto|remote/i.test(location);
}

async function getSavedOrigin(): Promise<SavedOrigin | null> {
  const url = databaseUrl();
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
    // La ruta habitual todavía puede no haberse guardado. En ese caso no hay
    // un punto privado de partida fiable para anticipar desplazamientos.
    return null;
  }
}

export async function buildCalendarTravelAlert(events: CalendarEventLike[], now = new Date()): Promise<CalendarTravelAlert | null> {
  const next = events
    .filter((event) => {
      if (event.allDay || !event.location?.trim() || looksRemote(event.location)) return false;
      const start = new Date(event.start).getTime();
      const diff = start - now.getTime();
      return Number.isFinite(start) && diff > 0 && diff <= MAX_EVENT_LOOKAHEAD_MS;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];

  if (!next?.location) return null;
  const origin = await getSavedOrigin();
  if (!origin) return null;

  const start = new Date(next.start);
  const estimate = await planDepartureForArrival({
    origin,
    destination: { address: next.location },
    arrivalTime: start,
    bufferMinutes: 10,
  });

  const leaveMinutes = Math.round(estimate.leaveInSeconds / 60);
  if (leaveMinutes > 30 || leaveMinutes < -20) return null;

  const phase = leaveMinutes <= 0 ? "late" : leaveMinutes <= 10 ? "leave" : "prepare";
  const routeMinutes = Math.max(1, Math.round(estimate.durationSeconds / 60));
  const trafficMinutes = estimate.trafficDelaySeconds === null
    ? null
    : Math.max(0, Math.round(estimate.trafficDelaySeconds / 60));
  const trafficText = trafficMinutes === null ? "" : ` Tráfico: +${trafficMinutes} min.`;

  return {
    id: `maps-calendar-${next.id}-${phase}`,
    severity: leaveMinutes <= 10 ? "alta" : "media",
    title: leaveMinutes <= 0
      ? `Conviene salir ya para ${next.title}`
      : `Para ${next.title}, salida en ${leaveMinutes} min`,
    detail: `${routeMinutes} min desde tu punto habitual guardado hasta ${next.location}.${trafficText}`,
    suggestedAction: "Abrir Movilidad y confirmar la ruta desde tu ubicación actual antes de salir.",
    eventAt: estimate.recommendedDepartureTime,
  };
}
