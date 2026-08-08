import { neon } from "@neondatabase/serverless";
import { planDepartureForArrival } from "./google/routes";

const TIME_ZONE = "Europe/Madrid";
const HOUR = 60 * 60 * 1000;

export type CommuteProfile = {
  destination: string;
  arrivalTime: string;
  bufferMinutes: number;
  weekdays: number[];
  enabled: boolean;
  originSaved: boolean;
  updatedAt: string;
};

type CommuteRow = {
  origin_lat: number;
  origin_lng: number;
  destination: string;
  arrival_time: string;
  buffer_minutes: number;
  weekdays: string;
  enabled: boolean;
  updated_at: string | Date;
};

export type CommuteAlert = {
  id: string;
  severity: "alta" | "media";
  title: string;
  detail: string;
  suggestedAction: string;
  eventAt: string;
};

function databaseUrl() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("commute_database_not_configured");
  return url;
}

function sql() {
  return neon(databaseUrl());
}

async function ensureTable() {
  await sql()`
    CREATE TABLE IF NOT EXISTS zyron_commute_profile (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      origin_lat DOUBLE PRECISION NOT NULL,
      origin_lng DOUBLE PRECISION NOT NULL,
      destination TEXT NOT NULL,
      arrival_time TEXT NOT NULL,
      buffer_minutes INTEGER NOT NULL DEFAULT 10,
      weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

function parseWeekdays(value: string) {
  return value.split(",").map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
}

function publicProfile(row: CommuteRow): CommuteProfile {
  return {
    destination: row.destination,
    arrivalTime: row.arrival_time,
    bufferMinutes: Number(row.buffer_minutes),
    weekdays: parseWeekdays(row.weekdays),
    enabled: Boolean(row.enabled),
    originSaved: true,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function getCommuteProfile(): Promise<CommuteProfile | null> {
  await ensureTable();
  const rows = await sql()`
    SELECT origin_lat, origin_lng, destination, arrival_time, buffer_minutes, weekdays, enabled, updated_at
    FROM zyron_commute_profile
    WHERE id = 1
    LIMIT 1
  `;
  const row = rows[0] as CommuteRow | undefined;
  return row ? publicProfile(row) : null;
}

export async function saveCommuteProfile(input: {
  origin: { latitude: number; longitude: number };
  destination: string;
  arrivalTime: string;
  bufferMinutes?: number;
  weekdays?: number[];
}) {
  const latitude = Number(input.origin.latitude);
  const longitude = Number(input.origin.longitude);
  const destination = input.destination.trim();
  const arrivalTime = input.arrivalTime.trim();
  const bufferMinutes = Math.max(0, Math.min(60, Math.round(input.bufferMinutes ?? 10)));
  const weekdays = [...new Set(input.weekdays ?? [1, 2, 3, 4, 5])]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((a, b) => a - b);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error("commute_origin_invalid");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error("commute_origin_invalid");
  if (!destination || destination.length > 300) throw new Error("commute_destination_invalid");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)) throw new Error("commute_arrival_invalid");
  if (!weekdays.length) throw new Error("commute_weekdays_invalid");

  await ensureTable();
  await sql()`
    INSERT INTO zyron_commute_profile (
      id, origin_lat, origin_lng, destination, arrival_time, buffer_minutes, weekdays, enabled, updated_at
    ) VALUES (
      1, ${latitude}, ${longitude}, ${destination}, ${arrivalTime}, ${bufferMinutes}, ${weekdays.join(",")}, TRUE, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      origin_lat = EXCLUDED.origin_lat,
      origin_lng = EXCLUDED.origin_lng,
      destination = EXCLUDED.destination,
      arrival_time = EXCLUDED.arrival_time,
      buffer_minutes = EXCLUDED.buffer_minutes,
      weekdays = EXCLUDED.weekdays,
      enabled = TRUE,
      updated_at = NOW()
  `;
  return getCommuteProfile();
}

export async function disableCommuteProfile() {
  await ensureTable();
  await sql()`UPDATE zyron_commute_profile SET enabled = FALSE, updated_at = NOW() WHERE id = 1`;
  return getCommuteProfile();
}

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
  const representedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return representedAsUtc - date.getTime();
}

function madridDateAtTime(reference: Date, hhmm: string) {
  const p = madridParts(reference);
  const [hour, minute] = hhmm.split(":").map(Number);
  const wallClockUtc = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0);
  let candidate = new Date(wallClockUtc - madridOffsetMs(new Date(wallClockUtc)));
  candidate = new Date(wallClockUtc - madridOffsetMs(candidate));
  return candidate;
}

function localDateKey(now: Date) {
  const p = madridParts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export async function buildCommuteAlert(now = new Date()): Promise<CommuteAlert | null> {
  await ensureTable();
  const rows = await sql()`
    SELECT origin_lat, origin_lng, destination, arrival_time, buffer_minutes, weekdays, enabled, updated_at
    FROM zyron_commute_profile
    WHERE id = 1 AND enabled = TRUE
    LIMIT 1
  `;
  const row = rows[0] as CommuteRow | undefined;
  if (!row) return null;

  const local = madridParts(now);
  const weekdays = parseWeekdays(row.weekdays);
  if (!weekdays.includes(local.weekday)) return null;

  const arrival = madridDateAtTime(now, row.arrival_time);
  const untilArrival = arrival.getTime() - now.getTime();
  if (untilArrival < -20 * 60_000 || untilArrival > 3 * HOUR) return null;

  const estimate = await planDepartureForArrival({
    origin: { latitude: Number(row.origin_lat), longitude: Number(row.origin_lng) },
    destination: { address: row.destination },
    arrivalTime: arrival,
    bufferMinutes: Number(row.buffer_minutes),
  });

  const leaveMinutes = Math.round(estimate.leaveInSeconds / 60);
  if (leaveMinutes > 30) return null;

  const phase = leaveMinutes <= 0 ? "late" : leaveMinutes <= 10 ? "leave" : "prepare";
  const severity: CommuteAlert["severity"] = leaveMinutes <= 10 ? "alta" : "media";
  const trafficMinutes = estimate.trafficDelaySeconds === null ? null : Math.max(0, Math.round(estimate.trafficDelaySeconds / 60));
  const routeMinutes = Math.max(1, Math.round(estimate.durationSeconds / 60));
  const trafficText = trafficMinutes === null ? "" : ` Tráfico: +${trafficMinutes} min.`;

  return {
    id: `maps-commute-${localDateKey(now)}-${phase}`,
    severity,
    title: leaveMinutes <= 0 ? "Conviene salir ya" : `Salida recomendada en ${leaveMinutes} min`,
    detail: `${routeMinutes} min hasta ${row.destination}.${trafficText}`,
    suggestedAction: "Abrir Movilidad para comprobar la ruta desde el punto guardado antes de salir.",
    eventAt: estimate.recommendedDepartureTime,
  };
}
