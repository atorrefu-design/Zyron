import { neon } from "@neondatabase/serverless";
import { planDepartureForArrival } from "./google/routes";

const TIME_ZONE = "Europe/Madrid";

type CommuteRow = {
  origin_lat: number;
  origin_lng: number;
  destination: string;
  arrival_time: string;
  buffer_minutes: number;
  weekdays: string;
  enabled: boolean;
};

export type CommuteBriefing = {
  state: "not_configured" | "disabled" | "inactive_today" | "passed" | "planned";
  text: string;
  destination?: string;
  recommendedDepartureTime?: string;
  durationMinutes?: number;
  trafficDelayMinutes?: number | null;
};

function madridParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const weekdayNames: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: weekdayNames[get("weekday")] || 0,
  };
}

function madridOffsetMs(date: Date) {
  const p = madridParts(date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

function madridDateAtTime(reference: Date, hhmm: string) {
  const p = madridParts(reference);
  const [hour, minute] = hhmm.split(":").map(Number);
  const wallClockUtc = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0);
  let candidate = new Date(wallClockUtc - madridOffsetMs(new Date(wallClockUtc)));
  candidate = new Date(wallClockUtc - madridOffsetMs(candidate));
  return candidate;
}

function formatClock(value: Date | string) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export async function buildCommuteBriefing(now = new Date()): Promise<CommuteBriefing> {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return { state: "not_configured", text: "Movilidad: todavía no hay una ruta habitual guardada." };

  const sql = neon(url);
  let rows;
  try {
    rows = await sql`
      SELECT origin_lat, origin_lng, destination, arrival_time, buffer_minutes, weekdays, enabled
      FROM zyron_commute_profile
      WHERE id = 1
      LIMIT 1
    `;
  } catch {
    return { state: "not_configured", text: "Movilidad: todavía no hay una ruta habitual guardada." };
  }

  const row = rows[0] as CommuteRow | undefined;
  if (!row) return { state: "not_configured", text: "Movilidad: todavía no hay una ruta habitual guardada." };
  if (!row.enabled) return { state: "disabled", text: "Movilidad: los avisos de tu ruta habitual están desactivados." };

  const weekdays = String(row.weekdays).split(",").map(Number);
  const local = madridParts(now);
  if (!weekdays.includes(local.weekday)) {
    return { state: "inactive_today", text: "Movilidad: tu ruta habitual está guardada, pero hoy no es uno de los días vigilados." };
  }

  const arrival = madridDateAtTime(now, row.arrival_time);
  if (arrival.getTime() <= now.getTime()) {
    return {
      state: "passed",
      destination: row.destination,
      text: `Movilidad: la hora habitual de llegada a ${row.destination} (${row.arrival_time}) ya ha pasado hoy.`,
    };
  }

  const estimate = await planDepartureForArrival({
    origin: { latitude: Number(row.origin_lat), longitude: Number(row.origin_lng) },
    destination: { address: row.destination },
    arrivalTime: arrival,
    bufferMinutes: Number(row.buffer_minutes),
  });
  const durationMinutes = Math.max(1, Math.round(estimate.durationSeconds / 60));
  const trafficDelayMinutes = estimate.trafficDelaySeconds === null
    ? null
    : Math.max(0, Math.round(estimate.trafficDelaySeconds / 60));
  const trafficText = trafficDelayMinutes === null ? "" : ` Tráfico estimado: +${trafficDelayMinutes} min.`;
  const marginText = Number(row.buffer_minutes) > 0 ? ` con ${Number(row.buffer_minutes)} min de margen` : "";

  return {
    state: "planned",
    destination: row.destination,
    recommendedDepartureTime: estimate.recommendedDepartureTime,
    durationMinutes,
    trafficDelayMinutes,
    text: `Movilidad: para llegar a ${row.destination} a las ${row.arrival_time}${marginText}, salida recomendada a las ${formatClock(estimate.recommendedDepartureTime)}. Trayecto: ${durationMinutes} min.${trafficText}`,
  };
}
