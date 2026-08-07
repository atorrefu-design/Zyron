import { NextResponse } from "next/server";
import { listActions } from "../../../lib/db";
import { getZyronHealth } from "../../../lib/health";
import { buildDailyPlan, formatDailyPlan } from "../../../lib/tools/planner";
import { getZyronTools } from "../../../lib/tools/registry";
import { listCalendarEvents } from "../../../lib/google/calendar";
import {
  compactSender,
  getInboxUnreadCount,
  listGmailMessages,
  prioritizeGmailMessages,
} from "../../../lib/google/gmail";

export const runtime = "nodejs";

function formatCalendarEvent(event: Awaited<ReturnType<typeof listCalendarEvents>>[number]) {
  if (event.allDay) return `• Todo el día · ${event.title}${event.location ? ` · ${event.location}` : ""}`;
  const date = new Date(event.start);
  const when = date.toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `• ${when} · ${event.title}${event.location ? ` · ${event.location}` : ""}`;
}

export async function GET() {
  try {
    const [plan, health, recentActions] = await Promise.all([
      buildDailyPlan(),
      getZyronHealth(),
      listActions(5),
    ]);

    const tools = getZyronTools();
    let calendarEvents: Awaited<ReturnType<typeof listCalendarEvents>> = [];
    let calendarError: string | null = null;
    let gmailError: string | null = null;
    let unreadCount: number | null = null;
    let priorityMail: Array<{
      from: string;
      subject: string;
      summary: string;
      reason: string;
      priority: "alta" | "media" | "baja";
    }> = [];

    await Promise.all([
      (async () => {
        try {
          const now = new Date();
          const end = new Date(now.getTime() + 48 * 60 * 60 * 1000);
          calendarEvents = await listCalendarEvents({ timeMin: now, timeMax: end, maxResults: 8 });
        } catch (error) {
          calendarError = error instanceof Error ? error.message : "calendar_error";
        }
      })(),
      (async () => {
        try {
          const [count, messages] = await Promise.all([
            getInboxUnreadCount(),
            listGmailMessages("in:inbox newer_than:3d", 20),
          ]);
          unreadCount = count;
          const priorities = await prioritizeGmailMessages(messages);
          const byId = new Map(priorities.map((item) => [item.id, item]));
          priorityMail = messages
            .map((message) => ({ message, priority: byId.get(message.id) }))
            .filter((item) => item.priority?.priority === "alta")
            .slice(0, 4)
            .map((item) => ({
              from: compactSender(item.message.from),
              subject: item.message.subject,
              summary: item.priority?.summary || item.message.snippet,
              reason: item.priority?.reason || "Conviene revisarlo.",
              priority: item.priority?.priority || "baja",
            }));
        } catch (error) {
          gmailError = error instanceof Error ? error.message : "gmail_error";
        }
      })(),
    ]);

    const missingContext = [
      calendarError ? "agenda" : null,
      tools.maps.status !== "available" ? "tráfico y desplazamientos" : null,
      gmailError ? "correo" : null,
    ].filter((item): item is string => Boolean(item));

    const limitations = missingContext.length
      ? `Todavía no puedo incorporar ${missingContext.join(", ")} en este briefing.`
      : "Todas las fuentes previstas para el briefing están disponibles.";

    const agenda = calendarError
      ? "Agenda: Google Calendar está conectado, pero todavía no puedo leer sus eventos. Revisa el permiso de Calendar."
      : calendarEvents.length
        ? `Agenda próximas 48 h:\n${calendarEvents.map(formatCalendarEvent).join("\n")}`
        : "Agenda próximas 48 h: no hay eventos programados.";

    const mail = gmailError
      ? "Correo: Gmail está conectado, pero no he podido preparar la prioridad de la bandeja."
      : priorityMail.length
        ? [
            `Correo: ${unreadCount ?? 0} sin leer en la bandeja. Entre los 20 recientes revisados, estos requieren más atención:`,
            ...priorityMail.map((item) => `• ${item.from} · ${item.subject}\n  ${item.summary}\n  ${item.reason}`),
          ].join("\n")
        : `Correo: ${unreadCount ?? 0} sin leer en la bandeja. No detecto correos de alta prioridad entre los 20 recientes revisados.`;

    const reply = [
      "Briefing de ZYRON",
      "",
      agenda,
      "",
      mail,
      "",
      formatDailyPlan(plan),
      "",
      health.ok ? "El núcleo está operativo." : "Hay algún servicio del núcleo que requiere revisión.",
      limitations,
    ].join("\n");

    return NextResponse.json(
      {
        reply,
        generatedAt: new Date().toISOString(),
        plan,
        calendarEvents,
        calendarConnected: !calendarError,
        gmailConnected: !gmailError,
        unreadCount,
        priorityMail,
        health,
        recentActions,
        limitations: missingContext,
        tool: "planner",
        action: "owner_briefing_created",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("ZYRON_BRIEFING_ERROR", error);
    return NextResponse.json({ error: "No he podido preparar el briefing." }, { status: 500 });
  }
}
