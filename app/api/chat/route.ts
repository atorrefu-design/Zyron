import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createTask, deleteTask, listTasks, recordAction, setTaskCompleted } from "../../../lib/db";
import { listCalendarEvents, type ZyronCalendarEvent } from "../../../lib/google/calendar";
import { toolSummary } from "../../../lib/tools/registry";

export const runtime = "nodejs";

const USER_ID = "aaron";
const AGENT_ID = "zyron";
const MADRID_TIME_ZONE = "Europe/Madrid";

type ChatMessage = { role: "user" | "assistant"; content: string };
type MemoryResult = { memory?: string };
type TaskIntent =
  | { action: "create"; query: string }
  | { action: "list"; query: "" }
  | { action: "complete"; query: string }
  | { action: "delete"; query: string }
  | { action: "none"; query: "" };
type CalendarIntent = "today" | "tomorrow" | "week" | "next" | null;

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
}

async function searchMemories(query: string): Promise<string[]> {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) return [];
  const response = await fetch("https://api.mem0.ai/v3/memories/search/", {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, filters: { user_id: USER_ID }, top_k: 8, threshold: 0.2, rerank: true }),
    cache: "no-store",
  });
  if (!response.ok) return [];
  const data = (await response.json()) as { results?: MemoryResult[] };
  return (data.results ?? []).map((item) => item.memory).filter((item): item is string => Boolean(item));
}

async function storeConversation(messages: ChatMessage[]): Promise<void> {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) return;
  await fetch("https://api.mem0.ai/v3/memories/add/", {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      user_id: USER_ID,
      agent_id: AGENT_ID,
      metadata: { source: "zyron-web" },
      custom_instructions: "Guarda únicamente hechos, preferencias, objetivos, rutinas, proyectos y decisiones útiles a largo plazo sobre Aarón. No guardes saludos, texto transitorio ni secretos.",
    }),
  });
}

async function safelyRecordAction(
  action: string,
  summary: string,
  metadata: Record<string, unknown> = {},
  tool = "tasks",
) {
  try {
    await recordAction(tool, action, summary, metadata);
  } catch (error) {
    console.error("ZYRON_ACTION_LOG_ERROR", error);
  }
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matchingTasks(query: string, tasks: Awaited<ReturnType<typeof listTasks>>) {
  const needle = normalize(query);
  return tasks.filter((task) => normalize(task.title).includes(needle) || needle.includes(normalize(task.title)));
}

function detectCalendarIntent(message: string): CalendarIntent {
  const clean = normalize(message);
  const asksCalendar = /\b(agenda|calendario|evento|eventos|reunion|reuniones|cita|citas|que tengo|proximo compromiso)\b/.test(clean);
  if (!asksCalendar) return null;
  if (/\bmanana\b/.test(clean)) return "tomorrow";
  if (/\b(esta semana|proximos dias|semana)\b/.test(clean)) return "week";
  if (/\b(proximo|siguiente|ahora)\b/.test(clean)) return "next";
  return "today";
}

function madridDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysToKey(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return madridDateKey(date);
}

function formatCalendarEvent(event: ZyronCalendarEvent) {
  if (event.allDay) return `Todo el día · ${event.title}${event.location ? ` · ${event.location}` : ""}`;
  const start = new Intl.DateTimeFormat("es-ES", {
    timeZone: MADRID_TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(event.start));
  return `${start} · ${event.title}${event.location ? ` · ${event.location}` : ""}`;
}

async function executeCalendarIntent(intent: Exclude<CalendarIntent, null>) {
  const now = new Date();
  const events = await listCalendarEvents({
    timeMin: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    timeMax: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000),
    maxResults: 50,
  });
  const todayKey = madridDateKey(now);
  const targetKey = intent === "tomorrow" ? addDaysToKey(todayKey, 1) : todayKey;

  let selected = events;
  let label = "los próximos siete días";
  if (intent === "today" || intent === "tomorrow") {
    selected = events.filter((event) => madridDateKey(event.start) === targetKey);
    label = intent === "today" ? "hoy" : "mañana";
  } else if (intent === "next") {
    selected = events.filter((event) => event.allDay || new Date(event.end).getTime() >= now.getTime()).slice(0, 1);
    label = "tu próximo evento";
  } else {
    selected = events.filter((event) => madridDateKey(event.start) >= todayKey);
  }

  await safelyRecordAction("calendar_read", `Consultó la agenda para ${label}: ${selected.length} eventos.`, { intent, count: selected.length }, "calendar");
  const reply = selected.length
    ? `${intent === "next" ? "Tu próximo evento es:" : `Tienes ${selected.length} evento${selected.length === 1 ? "" : "s"} ${label}:`}\n${selected.slice(0, 12).map((event, index) => `${index + 1}. ${formatCalendarEvent(event)}`).join("\n")}`
    : `No tienes eventos en Google Calendar ${label}.`;
  return { reply, action: "calendar_read", tool: "calendar", events: selected };
}

function deterministicTaskIntent(message: string): TaskIntent {
  const clean = message.trim();
  const createPatterns = [
    /^recu[eé]rdame\s+(?:que\s+)?(.+)$/i,
    /^apunta(?:me)?\s+(?:como\s+tarea\s+)?(.+)$/i,
    /^a[nñ]ade\s+(?:una\s+)?tarea(?:\s+para)?\s+(.+)$/i,
    /^crea\s+(?:una\s+)?tarea(?:\s+para)?\s+(.+)$/i,
  ];
  const completePatterns = [
    /^(?:marca|pon)\s+(?:como\s+)?(?:hecha|hecho|completada|completado)\s+(.+)$/i,
    /^(?:he\s+)?(?:terminado|completado)\s+(.+)$/i,
    /^completa\s+(?:la\s+tarea\s+)?(.+)$/i,
  ];
  const deletePatterns = [
    /^(?:borra|elimina|quita)\s+(?:la\s+)?tarea\s+(.+)$/i,
    /^(?:borra|elimina|quita)\s+(?:de\s+mis\s+tareas\s+)?(.+)$/i,
  ];

  for (const pattern of createPatterns) {
    const query = clean.match(pattern)?.[1]?.trim().replace(/[.!?]+$/, "");
    if (query && query.length <= 240) return { action: "create", query };
  }
  for (const pattern of completePatterns) {
    const query = clean.match(pattern)?.[1]?.trim().replace(/[.!?]+$/, "");
    if (query) return { action: "complete", query };
  }
  for (const pattern of deletePatterns) {
    const query = clean.match(pattern)?.[1]?.trim().replace(/[.!?]+$/, "");
    if (query) return { action: "delete", query };
  }
  if (/(?:qu[eé]|cu[aá]les).*(?:tareas|pendientes)|(?:tareas|pendientes).*(?:tengo|hay)/i.test(clean)) {
    return { action: "list", query: "" };
  }
  return { action: "none", query: "" };
}

function mayContainTaskIntent(message: string) {
  return /\b(tarea|tareas|pendiente|pendientes|apunta|apuntame|recu[eé]rdame|olvidarme|tengo que|debo|terminado|completado|hecho|borra|elimina|quita)\b/i.test(message);
}

async function classifyTaskIntent(message: string): Promise<TaskIntent> {
  const deterministic = deterministicTaskIntent(message);
  if (deterministic.action !== "none" || !mayContainTaskIntent(message)) return deterministic;

  const openai = getOpenAI();
  if (!openai) return deterministic;

  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions: [
        "Clasifica la intención del usuario respecto a su lista de tareas.",
        "Devuelve exclusivamente JSON válido con esta forma: {\"action\":\"create|list|complete|delete|none\",\"query\":\"texto\"}.",
        "create: quiere guardar algo pendiente, incluso con frases como 'tengo que' o 'no quiero olvidarme'.",
        "list: quiere consultar sus tareas.",
        "complete: dice que una tarea ya está hecha.",
        "delete: quiere borrar una tarea sin indicar que esté completada.",
        "none: no pide gestionar tareas.",
        "En query incluye solo el contenido útil de la tarea. Para list y none usa una cadena vacía.",
        `Herramientas registradas:\n${toolSummary()}`,
      ].join("\n"),
      input: message,
    });
    const parsed = JSON.parse(response.output_text.trim()) as { action?: string; query?: string };
    if (!["create", "list", "complete", "delete", "none"].includes(parsed.action || "")) return deterministic;
    const action = parsed.action as TaskIntent["action"];
    const query = typeof parsed.query === "string" ? parsed.query.trim().slice(0, 240) : "";
    if ((action === "create" || action === "complete" || action === "delete") && !query) return deterministic;
    return { action, query } as TaskIntent;
  } catch {
    return deterministic;
  }
}

async function executeTaskIntent(intent: TaskIntent) {
  if (intent.action === "create") {
    const task = await createTask(intent.query, null);
    await safelyRecordAction("task_created", `Creó la tarea “${task.title}”.`, { taskId: task.id, title: task.title });
    return { reply: `Hecho. He añadido “${task.title}” a tus tareas pendientes.`, action: "task_created", tool: "tasks", task };
  }

  if (intent.action === "list") {
    const pending = (await listTasks()).filter((task) => !task.completed);
    await safelyRecordAction("tasks_listed", `Consultó sus tareas pendientes: ${pending.length} encontradas.`, { count: pending.length });
    const reply = pending.length
      ? `Tienes ${pending.length} tarea${pending.length === 1 ? "" : "s"} pendiente${pending.length === 1 ? "" : "s"}:\n${pending.slice(0, 12).map((task, index) => `${index + 1}. ${task.title}`).join("\n")}`
      : "No tienes tareas pendientes. Mesa limpia, motor encendido.";
    return { reply, action: "tasks_listed", tool: "tasks", tasks: pending };
  }

  const tasks = await listTasks();
  const candidates = intent.action === "complete" ? tasks.filter((task) => !task.completed) : tasks;
  const matches = matchingTasks(intent.query, candidates);

  if (matches.length > 1) {
    const verb = intent.action === "complete" ? "marcar como completada" : "eliminar";
    return {
      reply: `He encontrado varias tareas parecidas. Dime cuál quieres ${verb}:\n${matches.slice(0, 6).map((task, index) => `${index + 1}. ${task.title}`).join("\n")}`,
      action: intent.action === "complete" ? "task_completion_ambiguous" : "task_deletion_ambiguous",
      tool: "tasks",
      tasks: matches.slice(0, 6),
    };
  }

  if (matches.length === 0) {
    return { reply: `No encuentro ninguna tarea que encaje con “${intent.query}”.`, action: "task_not_found", tool: "tasks" };
  }

  if (intent.action === "complete") {
    const task = await setTaskCompleted(matches[0].id, true);
    await safelyRecordAction("task_completed", `Completó la tarea “${matches[0].title}”.`, {
      taskId: matches[0].id,
      title: matches[0].title,
    });
    return { reply: `Perfecto. He marcado “${matches[0].title}” como completada.`, action: "task_completed", tool: "tasks", task };
  }

  await deleteTask(matches[0].id);
  await safelyRecordAction("task_deleted", `Eliminó la tarea “${matches[0].title}”.`, {
    taskId: matches[0].id,
    title: matches[0].title,
  });
  return { reply: `He eliminado la tarea “${matches[0].title}”.`, action: "task_deleted", tool: "tasks", task: matches[0] };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages = (body.messages ?? []).filter(
      (message): message is ChatMessage => (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
    );
    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content;
    if (!lastUserMessage) return NextResponse.json({ error: "Falta el mensaje del usuario" }, { status: 400 });

    const calendarIntent = detectCalendarIntent(lastUserMessage);
    if (calendarIntent) {
      try {
        const result = await executeCalendarIntent(calendarIntent);
        void storeConversation([{ role: "user", content: lastUserMessage }, { role: "assistant", content: result.reply }]).catch(() => undefined);
        return NextResponse.json(result);
      } catch (error) {
        console.error("ZYRON_CALENDAR_CHAT_ERROR", error);
        return NextResponse.json({
          reply: "Google Calendar está conectado, pero no he podido leer la agenda. Abre el Panel para comprobar si falta volver a autorizar el permiso de calendario.",
          action: "calendar_read_failed",
          tool: "calendar",
        });
      }
    }

    const taskIntent = await classifyTaskIntent(lastUserMessage);
    if (taskIntent.action !== "none") {
      const result = await executeTaskIntent(taskIntent);
      void storeConversation([{ role: "user", content: lastUserMessage }, { role: "assistant", content: result.reply }]).catch(() => undefined);
      return NextResponse.json(result);
    }

    const openai = getOpenAI();
    if (!openai) return NextResponse.json({ error: "OPENAI_API_KEY no está configurada" }, { status: 503 });
    const memories = await searchMemories(lastUserMessage);
    const memoryContext = memories.length ? memories.map((memory, index) => `${index + 1}. ${memory}`).join("\n") : "No hay recuerdos relevantes recuperados para este mensaje.";
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions: [
        "Eres ZYRON, el asistente personal privado de Aarón.",
        "Responde en castellano de España, de forma cercana, directa, honesta y práctica.",
        "No inventes información. Cuando falte un dato, dilo claramente y propón el siguiente paso útil.",
        "Usa los recuerdos como contexto, no los repitas de forma mecánica ni afirmes que son ciertos si contradicen el mensaje actual.",
        "El motor de acciones gestiona las tareas y consulta Google Calendar antes de llegar a esta conversación. No afirmes haber ejecutado acciones sin confirmación del sistema.",
        `Herramientas disponibles:\n${toolSummary()}`,
        `Recuerdos relevantes:\n${memoryContext}`,
      ].join("\n\n"),
      input: messages.slice(-12).map((message) => ({ role: message.role, content: message.content })),
    });
    const reply = response.output_text?.trim() || "No he podido construir una respuesta útil.";
    void storeConversation([{ role: "user", content: lastUserMessage }, { role: "assistant", content: reply }]).catch(() => undefined);
    return NextResponse.json({ reply, tool: memories.length ? "memory" : "conversation", memoriesUsed: memories.length });
  } catch (error) {
    console.error("ZYRON_CHAT_ERROR", error);
    return NextResponse.json({ error: "Error interno del núcleo de ZYRON" }, { status: 500 });
  }
}
