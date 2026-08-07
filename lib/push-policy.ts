import type { ProactiveAlert, ProactiveSource } from "./proactive";

const TIME_ZONE = "Europe/Madrid";
const QUIET_START_HOUR = 23;
const QUIET_END_HOUR = 7;
const CALENDAR_WARNING_MINUTES = 45;

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
  const calendarMinutes = alert.source === "calendar" ? minutesUntil(alert, now) : null;
  const imminentCalendar = calendarMinutes !== null
    && calendarMinutes >= -5
    && calendarMinutes <= CALENDAR_WARNING_MINUTES;

  if (isQuietTime(now)) {
    // No despertamos por correo, tareas o incidencias técnicas. Solo una cita realmente inminente.
    return imminentCalendar;
  }

  // En horario activo, prioridad alta o una cita ya cercana.
  return alert.severity === "alta" || imminentCalendar;
}

export function selectPushCandidates(alerts: ProactiveAlert[], now = new Date(), limit = 3) {
  const selected: ProactiveAlert[] = [];
  const sourceCounts = new Map<ProactiveSource, number>();

  for (const alert of alerts) {
    if (!shouldDeliverPush(alert, now)) continue;

    // Evita que tres correos automáticos o tres tareas monopolicen una notificación.
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
  };
}
