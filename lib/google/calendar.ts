import { getGoogleAccessToken } from "./oauth";

const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export type ZyronCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  htmlLink: string | null;
};

export type CreateCalendarEventInput = {
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  timeZone?: string;
};

type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  htmlLink?: string;
  status?: string;
};

function mapEvent(event: GoogleCalendarEvent): ZyronCalendarEvent {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  return {
    id: event.id as string,
    title: event.summary?.trim() || "Evento sin título",
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    allDay,
    location: event.location?.trim() || null,
    htmlLink: event.htmlLink || null,
  };
}

export async function listCalendarEvents(options?: {
  timeMin?: Date;
  timeMax?: Date;
  maxResults?: number;
}): Promise<ZyronCalendarEvent[]> {
  const accessToken = await getGoogleAccessToken();
  const timeMin = options?.timeMin ?? new Date();
  const timeMax = options?.timeMax ?? new Date(timeMin.getTime() + 7 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(options?.maxResults ?? 20),
  });

  const response = await fetch(`${CALENDAR_EVENTS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`google_calendar_events_${response.status}:${detail.slice(0, 300)}`);
  }

  const body = (await response.json()) as { items?: GoogleCalendarEvent[] };
  return (body.items ?? [])
    .filter((event) => event.status !== "cancelled" && event.id && event.start && event.end)
    .map(mapEvent);
}

export async function createCalendarEvent(input: CreateCalendarEventInput): Promise<ZyronCalendarEvent> {
  const title = input.title.trim();
  if (!title) throw new Error("calendar_title_required");

  const allDay = Boolean(input.allDay);
  const timeZone = input.timeZone || "Europe/Madrid";
  const payload = {
    summary: title,
    description: input.description?.trim() || undefined,
    location: input.location?.trim() || undefined,
    start: allDay ? { date: input.start } : { dateTime: input.start, timeZone },
    end: allDay ? { date: input.end } : { dateTime: input.end, timeZone },
  };

  const accessToken = await getGoogleAccessToken();
  const response = await fetch(CALENDAR_EVENTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`google_calendar_create_${response.status}:${detail.slice(0, 300)}`);
  }

  const event = (await response.json()) as GoogleCalendarEvent;
  if (!event.id || !event.start || !event.end) throw new Error("google_calendar_create_invalid_response");
  return mapEvent(event);
}
