import type { ProactiveAlert, ProactiveSource } from "./proactive";

const TIME_ZONE = "Europe/Madrid";
const QUIET_START_HOUR = 23;
const QUIET_END_HOUR = 7;
const CALENDAR_WARNING_MINUTES = 45;
const TRAVEL_WARNING_MINUTES = 30;

function localHour(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0);
}

function isQuietTime(now: Date) {
  const hour = localHour(now);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

function minutesUntil(alert: ProactiveAlert, now: Date) {
  if (!alert.eventAt) return null;
  const value = new Date(alert.eventAt).getTime();
  if (!Number.isFinite(value)) return null;
  return Math.round((value - now.getTime()) / 60000);
}

export function shouldDeliverPush(alert: ProactiveAlert, now = new Date()) {
  const eventMinutes = minutesUntil(alert, now);
  const imminentCalendar = alert.source === "calendar"
    && eventMinutes !== null
    && eventMinutes >= -5
    && eventMinutes <= CALENDAR_WARNING_MINUTES;
  const imminentTravel = alert.source === "maps"
    && eventMinutes !== null
    && eventMinutes >= -5
    && eventMinutes <= TRAVEL_WARNING_MINUTES;

  if (isQuietTime(now)) {
    // El correo, las tareas y las incidencias técnicas esperan. Una cita o salida
    // que el propietario haya pedido vigilar sí puede romper el silencio si ya es inminente.
    return imminentCalendar || (imminentTravel && eventMinutes !== null && eventMinutes <= 10);
  }

  return alert.severity === "alta" || imminentCalendar || imminentTravel;
}

export function selectPushCandidates(alerts: ProactiveAlert[], now = new Date(), limit = 3) {
  const selected: ProactiveAlert[] = [];
  const sourceCounts = new Map<ProactiveSource, number>();

  for (const alert of alerts) {
    if (!shouldDeliverPush(alert, now)) continue;

    const count = sourceCounts.get(alert.source) ?? 0;
    if (count >= 1) continue;

    selected.push(alert);
    sourceCounts.set(alert.source, count + 1);
    if (selected.length >= limit) break;
  }

  return selected;
}

export function pushPolicySummary(now = new Date()) {
  return {
    timeZone: TIME_ZONE,
    quietHours: `${QUIET_START_HOUR}:00-${QUIET_END_HOUR}:00`,
    quietNow: isQuietTime(now),
    calendarWarningMinutes: CALENDAR_WARNING_MINUTES,
    travelWarningMinutes: TRAVEL_WARNING_MINUTES,
  };
}
