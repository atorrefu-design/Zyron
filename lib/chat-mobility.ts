import { neon } from "@neondatabase/serverless";
import { listCalendarEvents } from "./google/calendar";
import { computeDrivingRoute, planDepartureForArrival } from "./google/routes";
import { buildCommuteBriefing } from "./commute-briefing";

const TIME_ZONE = "Europe/Madrid";
const HOUR = 60 * 60 * 1000;

type SavedOrigin = { latitude: number; longitude: number };
type SavedCommute = {
  origin: SavedOrigin;
  destination: string;
  arrivalTime: string;
  weekdays: number[];
};

type DepartureRequest = {
  hhmm: string;
  day: string | null;
  useHabitualDestination: boolean;
};

export type MobilityChatResult = {
  reply: string;
  action: "mobility_commute_read" | "mobility_calendar_read" | "mobility_target_read";
  tool: "maps";
};

export type MobilityChatOptions = {
  currentLocation?: SavedOrigin;
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

function formatDay(value: Date | string) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "short",
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

function madridDateKey(value: Date) {
  const p = madridParts(value);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function asksMobility(message: string) {
  const clean = normalize(message);
  const explicitMobility = /\b(trafico|ruta|trayecto|cuanto tardo|cuanto tardare|hora de salir|hora tengo que salir|cuando tengo que salir|cuando debo salir|a que hora salgo|a que hora tengo que salir|llego a tiempo|llegare a tiempo|salida recomendada)\b/.test(clean);
  const commuteArrival = /\b(llego|llegare|llegaria)\b.*\b(trabajo|oficina|curro)\b/.test(clean);
  const timedDeparture = /\b(salgo|saldre|saldria|salir)\b.*\blas?\s+\d{1,2}(?:[:.]\d{2})?\b/.test(clean);
  return explicitMobility || commuteArrival || timedDeparture;
}

function asksNextEventTravel(message: string) {
  const clean = normalize(message);
  return /\b(proxima|proximo|siguiente)\b/.test(clean)
    && /\b(cita|reunion|evento|compromiso)\b/.test(clean);
}

function explicitArrivalRequest(message: string) {
  const clean = normalize(message).replace(/\s+/g, " ").trim();
  const timeMatch = clean.match(/\b(?:a|para)\s+las?\s+([01]?\d|2[0-3])[:.]([0-5]\d)\b/)
    || clean.match(/\bllegar\s+(?:a|para)\s+las?\s+([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (!timeMatch) return null;

  const hhmm = `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2]}`;
  const beforeTime = clean.slice(0, timeMatch.index ?? clean.length).trim();
  let destination: string | null = null;

  const patterns = [
    /(?:llego|llegare)\s+a\s+tiempo\s+(?:a|al)\s+(.+?)(?:\s+si\s+quiero\s+llegar)?$/,
    /(?:quiero|tengo\s+que|debo)\s+llegar\s+(?:a|al)\s+(.+?)$/,
    /(?:salir|salgo)\s+(?:para|hacia|a)\s+(.+?)(?:\s+si\s+quiero\s+llegar)?$/,
  ];
  for (const pattern of patterns) {
    const match = beforeTime.match(pattern);
    if (match?.[1]) {
      destination = match[1].trim();
      break;
    }
  }

  const habitualAlias = destination && /^(?:mi\s+)?(?:trabajo|oficina|curro)$/.test(destination);
  return { hhmm, destination: habitualAlias ? null : destination, useHabitualDestination: Boolean(habitualAlias) };
}

function explicitDepartureRequest(message: string): DepartureRequest | null {
  const clean = normalize(message).replace(/\s+/g, " ").trim();
  const timeMatch = clean.match(/\b(?:si\s+)?(?:salgo|saldre|saldria|salir)\s+(?:a|sobre)\s+las?\s+([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\b/);
  if (!timeMatch) return null;

  const hhmm = `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2] || "00"}`;
  const dayMatch = clean.match(/\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  const useHabitualDestination = /\b(?:mi\s+)?(?:trabajo|oficina|curro)\b/.test(clean);
  return { hhmm, day: dayMatch?.[1] || null, useHabitualDestination };
}

function validOrigin(value: SavedOrigin | undefined): value is SavedOrigin {
  return Boolean(value)
    && Number.isFinite(value?.latitude)
    && Number.isFinite(value?.longitude)
    && Number(value?.latitude) >= -90
    && Number(value?.latitude) <= 90
    && Number(value?.longitude) >= -180
    && Number(value?.longitude) <= 180;
}

async function savedCommute(): Promise<SavedCommute | null> {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  try {
    const sql = neon(url);
    const rows = await sql`
      SELECT origin_lat, origin_lng, destination, arrival_time, weekdays
      FROM zyron_commute_profile
      WHERE id = 1 AND enabled = TRUE
      LIMIT 1
    `;
    const row = rows[0] as {
      origin_lat?: number;
      origin_lng?: number;
      destination?: string;
      arrival_time?: string;
      weekdays?: string;
    } | undefined;
    if (!row) return null;
    const latitude = Number(row.origin_lat);
    const longitude = Number(row.origin_lng);
    const destination = String(row.destination || "").trim();
    const arrivalTime = String(row.arrival_time || "").trim();
    const weekdays = String(row.weekdays || "1,2,3,4,5").split(",").map(Number).filter((day) => day >= 1 && day <= 7);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !destination || !/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)) return null;
    return { origin: { latitude, longitude }, destination, arrivalTime, weekdays };
  } catch {
    return null;
  }
}

async function savedOrigin(): Promise<SavedOrigin | null> {
  return (await savedCommute())?.origin ?? null;
}

function departureDate(request: DepartureRequest, now: Date, commute: SavedCommute) {
  const weekdayMap: Record<string, number> = {
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    domingo: 7,
  };

  if (request.day === "hoy") return madridDateAtTime(now, request.hhmm);
  if (request.day === "manana") return madridDateAtTime(new Date(now.getTime() + 24 * HOUR), request.hhmm);

  const requestedWeekday = request.day ? weekdayMap[request.day] : null;
  if (requestedWeekday) {
    const currentWeekday = madridParts(now).weekday;
    let days = (requestedWeekday - currentWeekday + 7) % 7;
    let candidate = madridDateAtTime(new Date(now.getTime() + days * 24 * HOUR), request.hhmm);
    if (candidate.getTime() <= now.getTime()) {
      days += 7;
      candidate = madridDateAtTime(new Date(now.getTime() + days * 24 * HOUR), request.hhmm);
    }
    return candidate;
  }

  const today = madridDateAtTime(now, request.hhmm);
  if (today.getTime() > now.getTime()) return today;

  const currentWeekday = madridParts(now).weekday;
  for (let days = 1; days <= 7; days += 1) {
    const weekday = ((currentWeekday - 1 + days) % 7) + 1;
    if (commute.weekdays.includes(weekday)) {
      return madridDateAtTime(new Date(now.getTime() + days * 24 * HOUR), request.hhmm);
    }
  }
  return madridDateAtTime(new Date(now.getTime() + 24 * HOUR), request.hhmm);
}

async function departureTimeTrip(request: DepartureRequest, currentLocation?: SavedOrigin, now = new Date()): Promise<MobilityChatResult> {
  const commute = await savedCommute();
  if (!commute || !request.useHabitualDestination) {
    return {
      reply: "Entiendo la hora a la que quieres salir, pero para saber si llegarás bien necesito tener guardada tu ruta habitual de trabajo en Movilidad.",
      action: "mobility_target_read",
      tool: "maps",
    };
  }

  const departure = departureDate(request, now, commute);
  if (departure.getTime() <= now.getTime()) {
    return {
      reply: `La salida indicada (${request.hhmm}) ya ha pasado para ese día. Dime otra hora y recalculo.`,
      action: "mobility_target_read",
      tool: "maps",
    };
  }

  const sameDay = madridDateKey(departure) === madridDateKey(now);
  const live = sameDay && validOrigin(currentLocation);
  const origin = live ? currentLocation : commute.origin;
  const targetArrival = madridDateAtTime(departure, commute.arrivalTime);
  const route = await computeDrivingRoute({
    origin,
    destination: { address: commute.destination },
    departureTime: departure,
  });

  const routeMinutes = Math.max(1, Math.round(route.durationSeconds / 60));
  const trafficMinutes = route.trafficDelaySeconds === null ? null : Math.max(0, Math.round(route.trafficDelaySeconds / 60));
  const estimatedArrival = new Date(departure.getTime() + route.durationSeconds * 1000);
  const deltaMinutes = Math.round((targetArrival.getTime() - estimatedArrival.getTime()) / 60000);
  const trafficText = trafficMinutes === null ? "" : ` Tráfico previsto: +${trafficMinutes} min.`;
  const originText = live ? "tu ubicación actual" : "tu punto habitual guardado";
  const dateText = formatDay(departure);

  if (deltaMinutes >= 0) {
    const margin = deltaMinutes === 0 ? "prácticamente a la hora" : `${deltaMinutes} min antes`;
    return {
      reply: `Sí. Si el ${dateText} sales a las ${request.hhmm} desde ${originText}, calculo unos ${routeMinutes} min hasta ${commute.destination}.${trafficText} Llegarías sobre las ${formatClock(estimatedArrival)}, ${margin} de tu hora habitual guardada (${commute.arrivalTime}).`,
      action: "mobility_target_read",
      tool: "maps",
    };
  }

  return {
    reply: `No parece suficiente. Si el ${dateText} sales a las ${request.hhmm} desde ${originText}, calculo unos ${routeMinutes} min hasta ${commute.destination}.${trafficText} Llegarías sobre las ${formatClock(estimatedArrival)}, aproximadamente ${Math.abs(deltaMinutes)} min después de tu hora habitual guardada (${commute.arrivalTime}).`,
    action: "mobility_target_read",
    tool: "maps",
  };
}

async function targetArrivalTrip(
  request: NonNullable<ReturnType<typeof explicitArrivalRequest>>,
  currentLocation?: SavedOrigin,
  now = new Date(),
): Promise<MobilityChatResult> {
  const commute = await savedCommute();
  const destination = request.destination || (request.useHabitualDestination ? commute?.destination : null);
  if (!destination) {
    return {
      reply: "Entiendo la hora de llegada, pero no sé qué dirección corresponde a ese destino. Guarda tu ruta habitual en Movilidad o dime una dirección concreta.",
      action: "mobility_target_read",
      tool: "maps",
    };
  }

  const live = validOrigin(currentLocation);
  const origin = live ? currentLocation : commute?.origin;
  if (!origin) {
    return {
      reply: "Puedo calcularlo, pero necesito un punto de salida. Permite la ubicación al hacer la consulta o guarda una ruta habitual en Movilidad.",
      action: "mobility_target_read",
      tool: "maps",
    };
  }

  const arrival = madridDateAtTime(now, request.hhmm);
  if (arrival.getTime() <= now.getTime()) {
    return {
      reply: `Las ${request.hhmm} ya han pasado hoy. Dime otra hora de llegada y recalculo desde ${live ? "tu ubicación actual" : "tu punto habitual"}.`,
      action: "mobility_target_read",
      tool: "maps",
    };
  }

  const [plan, routeNow] = await Promise.all([
    planDepartureForArrival({ origin, destination: { address: destination }, arrivalTime: arrival, bufferMinutes: 0 }),
    computeDrivingRoute({ origin, destination: { address: destination } }),
  ]);

  const routeMinutes = Math.max(1, Math.round(routeNow.durationSeconds / 60));
  const trafficMinutes = routeNow.trafficDelaySeconds === null ? null : Math.max(0, Math.round(routeNow.trafficDelaySeconds / 60));
  const trafficText = trafficMinutes === null ? "" : ` Tráfico actual: +${trafficMinutes} min.`;
  const arrivalIfLeavingNow = new Date(now.getTime() + routeNow.durationSeconds * 1000);
  const deltaMinutes = Math.round((arrival.getTime() - arrivalIfLeavingNow.getTime()) / 60000);
  const leaveInMinutes = Math.round(plan.leaveInSeconds / 60);
  const originText = live ? "tu ubicación actual" : "tu punto habitual guardado";

  if (deltaMinutes >= 0) {
    const margin = deltaMinutes > 0 ? ` Si sales ahora llegarías aproximadamente ${deltaMinutes} min antes.` : " Si sales ahora llegarías prácticamente a la hora.";
    const leaveText = leaveInMinutes > 0
      ? ` La salida límite estimada es a las ${formatClock(plan.recommendedDepartureTime)}, dentro de unos ${leaveInMinutes} min.`
      : " Conviene salir ya.";
    return {
      reply: `Sí. Desde ${originText} hasta ${destination} calculo unos ${routeMinutes} min.${trafficText}${margin}${leaveText}`,
      action: "mobility_target_read",
      tool: "maps",
    };
  }

  return {
    reply: `No con el tráfico actual. Desde ${originText} hasta ${destination} calculo unos ${routeMinutes} min.${trafficText} Si sales ahora llegarías sobre las ${formatClock(arrivalIfLeavingNow)}, aproximadamente ${Math.abs(deltaMinutes)} min tarde.`,
    action: "mobility_target_read",
    tool: "maps",
  };
}

async function nextCalendarTrip(now = new Date(), currentLocation?: SavedOrigin): Promise<MobilityChatResult> {
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

  const live = validOrigin(currentLocation);
  const origin = live ? currentLocation : await savedOrigin();
  if (!origin) {
    return {
      reply: `Tu próxima cita presencial es “${next.title}” en ${next.location}, pero no tengo un punto de salida disponible. Permite la ubicación al preguntarme por movilidad o abre Movilidad una vez y guarda tu ruta habitual.`,
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
  const originText = live ? "desde tu ubicación actual" : "desde tu punto habitual guardado";

  return {
    reply: `Tu próxima cita presencial es “${next.title}” el ${formatEventStart(next.start)} en ${next.location}. El trayecto estimado ${originText} es de ${routeMinutes} min.${trafficText} ${timing}`,
    action: "mobility_calendar_read",
    tool: "maps",
  };
}

async function habitualCommute(currentLocation?: SavedOrigin): Promise<MobilityChatResult> {
  const commute = await buildCommuteBriefing(new Date(), validOrigin(currentLocation) ? currentLocation : undefined);
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

export async function handleMobilityChat(message: string, options: MobilityChatOptions = {}): Promise<MobilityChatResult | null> {
  if (!asksMobility(message)) return null;
  const departure = explicitDepartureRequest(message);
  if (departure) return departureTimeTrip(departure, options.currentLocation);
  const target = explicitArrivalRequest(message);
  if (target) return targetArrivalTrip(target, options.currentLocation);
  if (asksNextEventTravel(message)) return nextCalendarTrip(new Date(), options.currentLocation);
  return habitualCommute(options.currentLocation);
}
