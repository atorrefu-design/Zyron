import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createTask, deleteTask, listTasks, recordAction, setTaskCompleted } from "../../../lib/db";
import { listCalendarEvents, type ZyronCalendarEvent } from "../../../lib/google/calendar";
import {
  compactSender,
  getInboxUnreadCount,
  listGmailMessages,
  prioritizeGmailMessages,
  type GmailMessage,
} from "../../../lib/google/gmail";
import {
  connectionHasScope,
  getGoogleConnection,
  GMAIL_READONLY_SCOPE,
} from "../../../lib/google/oauth";
import { toolSummary } from "../../../lib/tools/registry";
import { buildMemoryContext, recordManualMemoryFact } from "../../../lib/memory";

export const runtime = "nodejs";

const MADRID_TIME_ZONE = "Europe/Madrid";

type ChatMessage = { role: "user" | "assistant"; content: string };
type TaskIntent =
  | { action: "create"; query: string }
  | { action: "list"; query: "" }
  | { action: "complete"; query: string }
  | { action: "delete"; query: string }
  | { action: "none"; query: "" };
type CalendarIntent = "today" | "tomorrow" | "week" | "next" | null;
type GmailIntent = {
  mode: "recent" | "unread" | "important" | "sender" | "action";
  query: string;
  today: boolean;
  label: string;
} | null;

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
}

function explicitMemoryContent(message: string) {
  const patterns = [
    /^recuerda\s+(?:que\s+)?(.+)$/i,
    /^guarda\s+(?:en\s+tu\s+memoria\s+)?(?:que\s+)?(.+)$/i,
    /^memoriza\s+(?:que\s+)?(.+)$/i,
    /^a\s+partir\s+de\s+ahora[,\s]+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const content = message.trim().match(pattern)?.[1]?.trim().replace(/[.!?]+$/, "");
    if (content) return content;
  }
  return null;
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

function detectGmailIntent(message: string): GmailIntent {
  const clean = normalize(message);
  const asksGmail = /\b(correo|correos|email|emails|gmail|bandeja de entrada)\b/.test(clean);
  if (!asksGmail) return null;

  const today = /\bhoy\b/.test(clean);
  const period = today ? "newer_than:2d" : "newer_than:14d";

  if (/\b(no leido|no leidos|sin leer|pendientes de leer|pendiente de leer)\b/.test(clean)) {
    return { mode: "unread", query: `in:inbox ${period} is:unread`, today, label: today ? "sin leer de hoy" : "sin leer" };
  }

  if (/\b(requiere|requieren|accion|hacer algo|debo atender|tengo que atender|debo responder|tengo que responder|prioriza|prioridad)\b/.test(clean)) {
    return { mode: "action", query: "in:inbox newer_than:7d", today, label: "que pueden requerir acción" };
  }

  if (/\b(importante|importantes|prioritario|prioritarios|urgente|urgentes|destacado|destacados)\b/.test(clean)) {
    return { mode: "important", query: `in:inbox ${period}`, today, label: today ? "importantes de hoy" : "importantes recientes" };
  }

  const senderMatch = message.match(/\b(?:correo(?:s)?|email(?:s)?)\b.*?\b(?:de|desde)\s+([^?.!,]+)$/i);
  const sender = senderMatch?.[1]?.trim();
  if (sender && !/^(hoy|ayer|esta semana|la semana|los ultimos dias|los últimos dias)$/i.test(sender)) {
    const safeSender = sender.replace(/["\\]/g, " ").trim();
    return {
      mode: "sender",
      query: `in:inbox newer_than:30d from:"${safeSender}"`,
      today,
      label: `de ${sender}`,
    };
  }

  return { mode: "recent", query: `in:inbox ${period}`, today, label: today ? "de hoy" : "recientes" };
}

function detectCalendarIntent(message: string): CalendarIntent {
  const clean = normalize(message);
  const asksCalendar = /\b(agenda|calendario|evento|eventos|reunion|reuniones|cita|citas|proximo compromiso)\b/.test(clean)
    || /\bque tengo (hoy|manana|esta semana)\b/.test(clean);
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

function formatGmailMessage(message: GmailMessage) {
  const flags = `${message.starred ? "⭐ " : ""}${message.unread ? "● " : ""}`;
  const snippet = message.snippet.trim().replace(/\s+/g, " ").slice(0, 140);
  return `${flags}${compactSender(message.from)} · ${message.subject}${snippet ? `\n   ${snippet}` : ""}`;
}

async function executeGmailIntent(intent: Exclude<GmailIntent, null>) {
  const connection = await getGoogleConnection();
  if (!connection) {
    return {
      reply: "Google todavía no está conectado. Abre el Panel y conecta tu cuenta antes de pedirme correos.",
      action: "gmail_not_connected",
      tool: "gmail",
    };
  }
  if (!connectionHasScope(connection.scope, GMAIL_READONLY_SCOPE)) {
    return {
      reply: "Tu cuenta de Google está conectada, pero todavía no me has concedido permiso de lectura de Gmail. Vuelve a autorizar Google desde el Panel. Solo solicitaré lectura, no envío ni borrado.",
      action: "gmail_scope_missing",
      tool: "gmail",
      reauthorize: true,
    };
  }

  const fetchLimit = intent.mode === "action" || intent.today ? 20 : 15;
  let messages = await listGmailMessages(intent.query, fetchLimit);

  if (intent.today) {
    const today = madridDateKey(new Date());
    messages = messages.filter((message) => message.internalDate && madridDateKey(message.internalDate) === today);
  }

  if (intent.mode === "unread" && !intent.today) {
    const totalUnread = await getInboxUnreadCount();
    await safelyRecordAction("gmail_unread_count", `Consultó el total de correos sin leer: ${totalUnread}.`, { count: totalUnread }, "gmail");
    if (totalUnread === 0) {
      return { reply: "No tienes correos sin leer en la bandeja de entrada.", action: "gmail_read", tool: "gmail", messages: [] };
    }
    const visible = messages.slice(0, 8);
    return {
      reply: `Tienes ${totalUnread} correo${totalUnread === 1 ? "" : "s"} sin leer en la bandeja de entrada.${visible.length ? ` Te muestro ${visible.length} de los más recientes:\n${visible.map((message, index) => `${index + 1}. ${formatGmailMessage(message)}`).join("\n")}` : ""}`,
      action: "gmail_read",
      tool: "gmail",
      totalUnread,
      messages: visible,
    };
  }

  if (intent.mode === "action") {
    const priorities = await prioritizeGmailMessages(messages);
    const byId = new Map(priorities.map((item) => [item.id, item]));
    const ranked = messages.map((message) => ({ message, priority: byId.get(message.id) }))
      .sort((a, b) => {
        const rank = { alta: 3, media: 2, baja: 1 } as const;
        return rank[b.priority?.priority ?? "baja"] - rank[a.priority?.priority ?? "baja"];
      });
    const high = ranked.filter((item) => item.priority?.priority === "alta");
    const selected = (high.length ? high : ranked.filter((item) => item.priority?.priority === "media")).slice(0, 6);

    await safelyRecordAction(
      "gmail_priority_read",
      `Analizó ${messages.length} correos recientes y detectó ${high.length} de alta prioridad.`,
      { reviewed: messages.length, highPriority: high.length },
      "gmail",
    );

    if (!selected.length) {
      return {
        reply: `He revisado ${messages.length} correos recientes y no veo ninguno con señales claras de que requiera una acción por tu parte.`,
        action: "gmail_priority_read",
        tool: "gmail",
        messages: [],
      };
    }

    const heading = high.length
      ? `Entre los ${messages.length} correos recientes que he revisado, detecto ${high.length} de alta prioridad:`
      : `No veo ninguno de alta prioridad entre los ${messages.length} recientes, pero estos conviene revisarlos:`;
    const lines = selected.map((item, index) => {
      const priority = item.priority;
      return `${index + 1}. ${compactSender(item.message.from)} · ${item.message.subject}\n   ${priority?.summary || item.message.snippet}\n   Motivo: ${priority?.reason || "Conviene revisarlo."}`;
    });
    return {
      reply: `${heading}\n${lines.join("\n")}`,
      action: "gmail_priority_read",
      tool: "gmail",
      messages: selected.map((item) => item.message),
    };
  }

  if (intent.mode === "important") {
    messages = messages.filter((message) => message.important || message.starred);
  }

  await safelyRecordAction(
    "gmail_read",
    `Consultó correos ${intent.label}: ${messages.length} encontrados en la muestra consultada.`,
    { mode: intent.mode, count: messages.length, today: intent.today },
    "gmail",
  );

  if (!messages.length) {
    const detail = intent.mode === "important" ? " marcados por Gmail como importantes o destacados" : "";
    return {
      reply: `No encuentro correos${detail} ${intent.label}.`,
      action: "gmail_read",
      tool: "gmail",
      messages: [],
    };
  }

  const visible = messages.slice(0, 8);
  const prefix = intent.mode === "important"
    ? `Estos son los correos marcados por Gmail como importantes o destacados que he encontrado ${intent.label}:`
    : `Estos son los correos ${intent.label} que he encontrado:`;
  return {
    reply: `${prefix}\n${visible.map((message, index) => `${index + 1}. ${formatGmailMessage(message)}`).join("\n")}`,
    action: "gmail_read",
    tool: "gmail",
    messages: visible,
  };
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

    const explicitMemory = explicitMemoryContent(lastUserMessage);
    if (explicitMemory) {
      try {
        const block = await recordManualMemoryFact(explicitMemory, { source: "zyron-chat" });
        return NextResponse.json({
          reply: `Hecho. He guardado en mi memoria: “${explicitMemory}”.`,
          action: "memory_saved",
          tool: "memory",
          memoryBlockId: block.id,
        });
      } catch (error) {
        console.error("ZYRON_EXPLICIT_MEMORY_ERROR", error);
        return NextResponse.json({
          reply: "No he podido guardar esa información en la memoria persistente. No voy a fingir que la recordaré.",
          action: "memory_save_failed",
          tool: "memory",
        }, { status: 503 });
      }
    }

    const gmailIntent = detectGmailIntent(lastUserMessage);
    if (gmailIntent) {
      try {
        const result = await executeGmailIntent(gmailIntent);
        return NextResponse.json(result);
      } catch (error) {
        console.error("ZYRON_GMAIL_CHAT_ERROR", error);
        return NextResponse.json({
          reply: "No he podido leer Gmail ahora mismo. El permiso está configurado, así que prueba de nuevo en unos segundos. Si persiste, revisaremos el diagnóstico de Gmail desde el Panel.",
          action: "gmail_read_failed",
          tool: "gmail",
        });
      }
    }

    const calendarIntent = detectCalendarIntent(lastUserMessage);
    if (calendarIntent) {
      try {
        const result = await executeCalendarIntent(calendarIntent);
        return NextResponse.json(result);
      } catch (error) {
        console.error("ZYRON_CALENDAR_CHAT_ERROR", error);
        return NextResponse.json({
          reply: "Google Calendar está conectado, pero no he podido leer la agenda. Abre el Panel para comprobar el estado de Google.",
          action: "calendar_read_failed",
          tool: "calendar",
        });
      }
    }

    const taskIntent = await classifyTaskIntent(lastUserMessage);
    if (taskIntent.action !== "none") {
      const result = await executeTaskIntent(taskIntent);
      return NextResponse.json(result);
    }

    const openai = getOpenAI();
    if (!openai) return NextResponse.json({ error: "OPENAI_API_KEY no está configurada" }, { status: 503 });
    const localMemory = await buildMemoryContext(lastUserMessage).catch((error) => {
      console.error("ZYRON_LOCAL_MEMORY_SEARCH_ERROR", error);
      return { context: "La memoria local no está disponible temporalmente.", blocks: [] };
    });
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions: [
        "Eres ZYRON, el asistente personal privado de Aarón.",
        "Responde en castellano de España, de forma cercana, directa, honesta y práctica.",
        "No inventes información. Cuando falte un dato, dilo claramente y propón el siguiente paso útil.",
        "Usa la memoria como contexto de trabajo y aplica sus preferencias de forma silenciosa; no la recites de forma mecánica.",
        "Una corrección nueva de Aarón prevalece sobre un bloque anterior incompatible. Distingue los datos permanentes de los dinámicos y verifica estos últimos en una fuente actual cuando corresponda.",
        "El motor de acciones gestiona tareas y consulta Google Calendar y Gmail antes de llegar a esta conversación. No afirmes haber leído datos privados o ejecutado acciones si el sistema no te los ha proporcionado.",
        `Herramientas disponibles:\n${toolSummary()}`,
        `Memoria privada local de ZYRON:\n${localMemory.context}`,
      ].join("\n\n"),
      input: messages.slice(-12).map((message) => ({ role: message.role, content: message.content })),
    });
    const reply = response.output_text?.trim() || "No he podido construir una respuesta útil.";
    const memoriesUsed = localMemory.blocks.length;
    return NextResponse.json({ reply, tool: memoriesUsed ? "memory" : "conversation", memoriesUsed });
  } catch (error) {
    console.error("ZYRON_CHAT_ERROR", error);
    return NextResponse.json({ error: "Error interno del núcleo de ZYRON" }, { status: 500 });
  }
}
