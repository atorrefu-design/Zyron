import { getZyronHealth } from "./health";
import { listTasks } from "./db";
import { listCalendarEvents } from "./google/calendar";
import { compactSender, listGmailMessages, prioritizeGmailMessages } from "./google/gmail";

export type ProactiveSeverity = "alta" | "media" | "baja";
export type ProactiveSource = "system" | "tasks" | "calendar" | "gmail";

export type ProactiveAlert = {
  id: string;
  severity: ProactiveSeverity;
  source: ProactiveSource;
  title: string;
  detail: string;
  suggestedAction: string;
  eventAt?: string | null;
};

export type ProactiveAlertResult = {
  alerts: ProactiveAlert[];
  generatedAt: string;
  diagnostics: Record<ProactiveSource, "ok" | "unavailable">;
};

const HOUR = 60 * 60 * 1000;

function actionFromReason(reason: string) {
  const match = reason.match(/Acción sugerida:\s*(.+)$/i);
  return match?.[1]?.trim() || "Revisar antes de decidir.";
}

function reasonWithoutAction(reason: string) {
  return reason.replace(/\s*Acción sugerida:\s*.+$/i, "").replace(/^Motivo:\s*/i, "").trim();
}

function severityRank(value: ProactiveSeverity) {
  return value === "alta" ? 3 : value === "media" ? 2 : 1;
}

export async function buildProactiveAlerts(now = new Date()): Promise<ProactiveAlertResult> {
  const diagnostics: ProactiveAlertResult["diagnostics"] = {
    system: "ok",
    tasks: "ok",
    calendar: "ok",
    gmail: "ok",
  };
  const alerts: ProactiveAlert[] = [];

  const [healthResult, tasksResult, calendarResult, gmailResult] = await Promise.allSettled([
    getZyronHealth(),
    listTasks(),
    listCalendarEvents({ timeMin: now, timeMax: new Date(now.getTime() + 24 * HOUR), maxResults: 12 }),
    (async () => {
      const messages = await listGmailMessages("in:inbox newer_than:2d", 12);
      const priorities = await prioritizeGmailMessages(messages);
      return { messages, priorities };
    })(),
  ]);

  if (healthResult.status === "fulfilled") {
    if (!healthResult.value.ok) {
      const failed = Object.entries(healthResult.value.checks)
        .filter(([, check]) => !check.configured || check.reachable === false)
        .map(([name]) => name);
      alerts.push({
        id: `system-${now.toISOString().slice(0, 13)}`,
        severity: "alta",
        source: "system",
        title: "ZYRON necesita atención técnica",
        detail: failed.length ? `Servicios con incidencia: ${failed.join(", ")}.` : "El núcleo informa de una degradación parcial.",
        suggestedAction: "Abrir el Panel y revisar el diagnóstico antes de depender de esos servicios.",
      });
    }
  } else {
    diagnostics.system = "unavailable";
  }

  if (tasksResult.status === "fulfilled") {
    for (const task of tasksResult.value.filter((item) => !item.completed && item.due_at)) {
      const dueAt = new Date(task.due_at as string);
      const diff = dueAt.getTime() - now.getTime();
      if (!Number.isFinite(diff) || diff > 24 * HOUR) continue;

      const overdue = diff < 0;
      const severity: ProactiveSeverity = overdue || diff <= 6 * HOUR ? "alta" : "media";
      alerts.push({
        id: `task-${task.id}`,
        severity,
        source: "tasks",
        title: overdue ? `Tarea vencida: ${task.title}` : `Tarea próxima: ${task.title}`,
        detail: overdue
          ? `La fecha límite pasó hace ${Math.max(1, Math.round(Math.abs(diff) / HOUR))} h.`
          : `Vence en aproximadamente ${Math.max(1, Math.round(diff / HOUR))} h.`,
        suggestedAction: overdue ? "Decidir si hacerla ahora, reprogramarla o descartarla." : "Reservar tiempo para completarla antes del vencimiento.",
        eventAt: dueAt.toISOString(),
      });
    }
  } else {
    diagnostics.tasks = "unavailable";
  }

  if (calendarResult.status === "fulfilled") {
    for (const event of calendarResult.value) {
      if (event.allDay) continue;
      const start = new Date(event.start);
      const diff = start.getTime() - now.getTime();
      if (!Number.isFinite(diff) || diff < -15 * 60 * 1000 || diff > 2 * HOUR) continue;

      const severity: ProactiveSeverity = diff <= 30 * 60 * 1000 ? "alta" : "media";
      const minutes = Math.max(0, Math.round(diff / 60000));
      alerts.push({
        id: `calendar-${event.id}`,
        severity,
        source: "calendar",
        title: `Próximo evento: ${event.title}`,
        detail: diff <= 0 ? "El evento ya debería estar empezando." : `Empieza en unos ${minutes} min.${event.location ? ` Ubicación: ${event.location}.` : ""}`,
        suggestedAction: diff <= 30 * 60 * 1000 ? "Prepararte o salir con margen si requiere desplazamiento." : "Tenerlo presente y comprobar si necesitas preparar algo.",
        eventAt: start.toISOString(),
      });
    }
  } else {
    diagnostics.calendar = "unavailable";
  }

  if (gmailResult.status === "fulfilled") {
    const byId = new Map(gmailResult.value.priorities.map((item) => [item.id, item]));
    const highPriority = gmailResult.value.messages
      .map((message) => ({ message, priority: byId.get(message.id) }))
      .filter((item) => item.priority?.priority === "alta")
      .slice(0, 3);

    for (const { message, priority } of highPriority) {
      const reason = priority?.reason || "Correo con señales de prioridad alta.";
      alerts.push({
        id: `gmail-${message.id}`,
        severity: "alta",
        source: "gmail",
        title: `${compactSender(message.from)} · ${message.subject}`,
        detail: priority?.summary || reasonWithoutAction(reason) || message.snippet,
        suggestedAction: actionFromReason(reason),
        eventAt: message.internalDate,
      });
    }
  } else {
    diagnostics.gmail = "unavailable";
  }

  alerts.sort((a, b) => {
    const priority = severityRank(b.severity) - severityRank(a.severity);
    if (priority !== 0) return priority;
    const aTime = a.eventAt ? new Date(a.eventAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.eventAt ? new Date(b.eventAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  return {
    alerts: alerts.slice(0, 8),
    generatedAt: now.toISOString(),
    diagnostics,
  };
}
