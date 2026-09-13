import { listJournal } from "../journal";
import { createTask, listActions, listTasks, recordAction, setTaskCompleted } from "../db";
import { getZyronHealth } from "../health";
import { listCalendarEvents } from "../google/calendar";
import { getInboxUnreadCount } from "../google/gmail";
import { buildDailyPlan, formatDailyPlan } from "../tools/planner";
import { normalizeDeterministicText, resolveDeterministicCommand, type DeterministicCommand } from "./deterministic-intent";

export { resolveDeterministicCommand } from "./deterministic-intent";

export type DeterministicResult = {
  handled: true;
  reply: string;
  action: string;
  tool: string;
  creditsUsed: false;
  data?: unknown;
};

function taskMatches(query: string, title: string) {
  const needle = normalizeDeterministicText(query);
  const candidate = normalizeDeterministicText(title);
  return candidate.includes(needle) || needle.includes(candidate);
}

function madridDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function quickBriefing(): Promise<DeterministicResult> {
  const now = new Date();
  const [planResult, calendarResult, mailResult] = await Promise.allSettled([
    buildDailyPlan(6),
    listCalendarEvents({ timeMin: now, timeMax: new Date(now.getTime() + 36 * 60 * 60 * 1000), maxResults: 8 }),
    getInboxUnreadCount(),
  ]);
  const plan = planResult.status === "fulfilled" ? formatDailyPlan(planResult.value) : "Tareas: no disponibles ahora mismo.";
  const agenda = calendarResult.status === "fulfilled"
    ? calendarResult.value.length
      ? `Agenda próximas 36 h:\n${calendarResult.value.map((event) => `• ${event.allDay ? "Todo el día" : madridDate(event.start)} · ${event.title}`).join("\n")}`
      : "Agenda próximas 36 h: sin eventos."
    : "Agenda: no disponible ahora mismo.";
  const mail = mailResult.status === "fulfilled"
    ? `Gmail: ${mailResult.value} correo${mailResult.value === 1 ? "" : "s"} sin leer.`
    : "Gmail: no disponible ahora mismo.";
  const reply = ["Briefing operativo de ZYRON", agenda, mail, plan, "Generado directamente, sin modelo de IA."].join("\n\n");
  await recordAction("core", "direct_briefing_created", "Preparó un briefing operativo sin modelo de IA.", {
    calendar: calendarResult.status,
    gmail: mailResult.status,
    tasks: planResult.status,
  });
  return { handled: true, reply, action: "direct_briefing_created", tool: "core", creditsUsed: false };
}

export async function executeDeterministicCommand(command: DeterministicCommand): Promise<DeterministicResult> {
  if (command.type === "tasks_list") {
    const tasks = (await listTasks()).filter((task) => !task.completed);
    await recordAction("tasks", "tasks_listed_direct", `Consultó ${tasks.length} tareas sin modelo de IA.`, { count: tasks.length });
    const reply = tasks.length
      ? `Tiene ${tasks.length} tarea${tasks.length === 1 ? "" : "s"} pendiente${tasks.length === 1 ? "" : "s"}:\n${tasks.slice(0, 20).map((task, index) => `${index + 1}. ${task.title}${task.due_at ? ` · ${madridDate(task.due_at)}` : ""}`).join("\n")}`
      : "No tiene tareas pendientes.";
    return { handled: true, reply, action: "tasks_listed_direct", tool: "tasks", creditsUsed: false, data: tasks };
  }

  if (command.type === "task_create") {
    if (!command.query) return { handled: true, reply: "Escribe /tarea seguido de lo que desea apuntar.", action: "task_input_required", tool: "tasks", creditsUsed: false };
    const task = await createTask(command.query, null);
    await recordAction("tasks", "task_created_direct", `Creó la tarea “${task.title}” sin modelo de IA.`, { taskId: task.id });
    return { handled: true, reply: `Hecho. He creado la tarea “${task.title}”.`, action: "task_created_direct", tool: "tasks", creditsUsed: false, data: task };
  }

  if (command.type === "task_complete") {
    if (!command.query) return { handled: true, reply: "Escribe /completar seguido del nombre de la tarea.", action: "task_input_required", tool: "tasks", creditsUsed: false };
    const matches = (await listTasks()).filter((task) => !task.completed && taskMatches(command.query, task.title));
    if (matches.length !== 1) {
      const reply = matches.length
        ? `He encontrado varias tareas parecidas:\n${matches.slice(0, 6).map((task, index) => `${index + 1}. ${task.title}`).join("\n")}\nIndique el nombre exacto.`
        : `No encuentro una tarea pendiente que encaje con “${command.query}”.`;
      return { handled: true, reply, action: matches.length ? "task_completion_ambiguous" : "task_not_found", tool: "tasks", creditsUsed: false, data: matches };
    }
    const task = await setTaskCompleted(matches[0].id, true);
    await recordAction("tasks", "task_completed_direct", `Completó la tarea “${matches[0].title}” sin modelo de IA.`, { taskId: matches[0].id });
    return { handled: true, reply: `Perfecto. He marcado “${matches[0].title}” como completada.`, action: "task_completed_direct", tool: "tasks", creditsUsed: false, data: task };
  }

  if (command.type === "daily_plan") {
    const plan = await buildDailyPlan(8);
    return { handled: true, reply: `${formatDailyPlan(plan)}\n\nGenerado directamente, sin modelo de IA.`, action: "daily_plan_created", tool: "planner", creditsUsed: false, data: plan };
  }

  if (command.type === "briefing") return quickBriefing();

  if (command.type === "activity") {
    const actions = await listActions(8);
    const reply = actions.length
      ? `Últimas acciones verificadas de ZYRON:\n${actions.map((action) => `• ${madridDate(action.created_at)} · ${action.summary}`).join("\n")}\n\nConsulta directa, sin modelo de IA.`
      : "Todavía no hay acciones registradas.";
    return { handled: true, reply, action: "activity_read_direct", tool: "audit", creditsUsed: false, data: actions };
  }

  const health = await getZyronHealth();
  const labels: Record<string, string> = { openai: "OpenAI", aiGateway: "AI Gateway", database: "Base de datos", memory: "Memoria", maps: "Google Maps", ownerKey: "Acceso privado", authSecret: "Sesión segura" };
  const lines = Object.entries(health.checks).map(([name, check]) => {
    const state = !check.configured ? "no configurado" : check.reachable === false ? "con incidencia" : check.reachable === true ? "verificado" : "configurado, sin comprobar";
    return `• ${labels[name] || name}: ${state}${check.latencyMs !== null ? ` · ${check.latencyMs} ms` : ""}`;
  });
  const reply = [`Diagnóstico de ZYRON: ${health.ok ? "núcleo operativo" : "requiere revisión"}.`, ...lines, "", "Comprobación directa, sin modelo de IA."].join("\n");
  return { handled: true, reply, action: "diagnostics_read_direct", tool: "health", creditsUsed: false, data: health };
}

export async function runDeterministicCommand(text: string) {
  const history = text.trim().match(/^(?:historial|busca en (?:el )?historial)(?:\s*[: ]\s*([\s\S]*))?$/i);
  if (history) {
    try {
      const entries = (await listJournal(history[1]?.trim() || "")).slice(0,6);
      return {handled:true,action:"history_read_direct",tool:"history",creditsUsed:false,
        reply:entries.length ? entries.map(e=>`${e.channel} · ${e.role === "user" ? "Usted" : "Zyron"} · ${madridDate(e.occurredAt)}: ${e.content.slice(0,1200)}`).join("\n\n") : "No encuentro conversaciones guardadas para esa búsqueda."} satisfies DeterministicResult;
    } catch { return {handled:true,action:"history_unavailable",tool:"history",creditsUsed:false,reply:"El historial no está disponible ahora mismo."} satisfies DeterministicResult; }
  }
  const command = resolveDeterministicCommand(text);
  if (!command) return null;
  try {
    return await executeDeterministicCommand(command);
  } catch (error) {
    console.error("ZYRON_DETERMINISTIC_COMMAND_ERROR", command.type, error instanceof Error ? error.message : "unknown");
    return {
      handled: true,
      reply: "He reconocido la orden, pero la fuente necesaria no está disponible ahora mismo. No he ejecutado ningún reintento automático.",
      action: "direct_command_unavailable",
      tool: "core",
      creditsUsed: false,
    } satisfies DeterministicResult;
  }
}
