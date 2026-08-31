import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { buildDailyPlan, formatDailyPlan } from "../tools/planner";
import { createTask, listTasks, recordAction, setTaskCompleted } from "../db";
import { listCalendarEvents } from "../google/calendar";
import { buildMemoryContext, recordManualMemoryFact } from "../memory";
import { authorizeAgentTool, type ZyronAgentToolName } from "./policy";

export type ZyronAgentToolResult = {
  ok: boolean;
  summary: string;
  data?: unknown;
};

export const agentToolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "Lista las tareas pendientes reales de Aarón.",
      strict: true,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Crea una tarea persistente. Úsala cuando Aarón pida apuntar, recordar o registrar algo pendiente.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título limpio y concreto, máximo 240 caracteres." },
          due_at: { type: ["string", "null"], description: "Fecha ISO 8601 si se conoce con precisión; si no, null." },
        },
        required: ["title", "due_at"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: "Marca como completada una tarea existente cuando la referencia es inequívoca.",
      strict: true,
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Texto para localizar la tarea." } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_daily_plan",
      description: "Ordena las tareas pendientes y devuelve un plan breve del día.",
      strict: true,
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 12 } },
        required: ["limit"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description: "Recupera contexto de la memoria privada de ZYRON para una pregunta concreta.",
      strict: true,
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Consulta precisa de memoria." } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description: "Guarda una memoria permanente solo si Aarón lo ha pedido de forma explícita.",
      strict: true,
      parameters: {
        type: "object",
        properties: { fact: { type: "string", description: "Hecho o preferencia útil, sin texto accesorio." } },
        required: ["fact"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_calendar",
      description: "Lee eventos reales del Google Calendar conectado.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          range: { type: "string", enum: ["today", "tomorrow", "week", "next"] },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["range", "limit"],
        additionalProperties: false,
      },
    },
  },
];

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function textArgument(args: Record<string, unknown>, key: string, max = 500) {
  const value = typeof args[key] === "string" ? args[key].trim() : "";
  return value.slice(0, max);
}

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function madridDateKey(value: Date | string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

function tomorrowKey(todayKey: string) {
  const [year, month, day] = todayKey.split("-").map(Number);
  return madridDateKey(new Date(Date.UTC(year, month - 1, day + 1, 12)));
}

async function audit(action: string, summary: string, metadata: Record<string, unknown> = {}) {
  try {
    await recordAction("agent", action, summary, metadata);
  } catch (error) {
    console.error("ZYRON_AGENT_AUDIT_ERROR", error);
  }
}

async function readCalendar(args: Record<string, unknown>): Promise<ZyronAgentToolResult> {
  const allowedRanges = new Set(["today", "tomorrow", "week", "next"]);
  const range = typeof args.range === "string" && allowedRanges.has(args.range) ? args.range : "week";
  const limit = Math.max(1, Math.min(Number(args.limit) || 8, 20));
  const now = new Date();
  const events = await listCalendarEvents({
    timeMin: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    timeMax: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000),
    maxResults: 50,
  });
  const today = madridDateKey(now);
  const tomorrow = tomorrowKey(today);
  let selected = events.filter((event) => event.allDay || new Date(event.end).getTime() >= now.getTime());
  if (range === "today") selected = selected.filter((event) => madridDateKey(event.start) === today);
  if (range === "tomorrow") selected = selected.filter((event) => madridDateKey(event.start) === tomorrow);
  if (range === "next") selected = selected.slice(0, 1);
  selected = selected.slice(0, limit);

  const data = selected.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location || null,
  }));
  await audit("calendar_read", `Consultó el calendario (${range}) y obtuvo ${data.length} eventos.`, { range, count: data.length });
  return { ok: true, summary: `Calendario consultado: ${data.length} eventos.`, data };
}

export async function executeAgentTool(input: {
  name: string;
  arguments: string;
  userMessage: string;
}): Promise<ZyronAgentToolResult> {
  const authorization = authorizeAgentTool(input.name, input.userMessage);
  if (!authorization.allowed) return { ok: false, summary: authorization.reason };
  const name = input.name as ZyronAgentToolName;
  const args = parseArguments(input.arguments);

  try {
    if (name === "list_tasks") {
      const tasks = (await listTasks()).filter((task) => !task.completed).slice(0, 30);
      await audit("tasks_listed", `Consultó ${tasks.length} tareas pendientes.`, { count: tasks.length });
      return { ok: true, summary: `${tasks.length} tareas pendientes.`, data: tasks };
    }

    if (name === "create_task") {
      const title = textArgument(args, "title", 240).replace(/[.!?]+$/, "");
      if (!title) return { ok: false, summary: "Falta un título válido para la tarea." };
      const dueCandidate = typeof args.due_at === "string" ? args.due_at : null;
      const dueAt = dueCandidate && Number.isFinite(new Date(dueCandidate).getTime()) ? new Date(dueCandidate).toISOString() : null;
      const task = await createTask(title, dueAt);
      await audit("task_created", `Creó la tarea “${task.title}”.`, { taskId: task.id, dueAt: task.due_at });
      return { ok: true, summary: `Tarea creada: ${task.title}.`, data: task };
    }

    if (name === "complete_task") {
      const query = textArgument(args, "query", 240);
      if (!query) return { ok: false, summary: "Falta identificar la tarea." };
      const needle = normalized(query);
      const matches = (await listTasks()).filter((task) => !task.completed)
        .filter((task) => normalized(task.title).includes(needle) || needle.includes(normalized(task.title)));
      if (matches.length !== 1) {
        return {
          ok: false,
          summary: matches.length ? "Hay varias tareas compatibles; Aarón debe elegir una." : "No se ha encontrado una tarea compatible.",
          data: matches.slice(0, 6).map((task) => ({ id: task.id, title: task.title })),
        };
      }
      const task = await setTaskCompleted(matches[0].id, true);
      await audit("task_completed", `Completó la tarea “${matches[0].title}”.`, { taskId: matches[0].id });
      return { ok: true, summary: `Tarea completada: ${matches[0].title}.`, data: task };
    }

    if (name === "build_daily_plan") {
      const limit = Math.max(1, Math.min(Number(args.limit) || 6, 12));
      const plan = await buildDailyPlan(limit);
      return { ok: true, summary: formatDailyPlan(plan), data: plan };
    }

    if (name === "search_memory") {
      const query = textArgument(args, "query", 500) || input.userMessage;
      const memory = await buildMemoryContext(query, 12_000);
      return {
        ok: true,
        summary: `Memoria recuperada: ${memory.blocks.length} bloques relevantes.`,
        data: { context: memory.context, blocks: memory.blocks.map((block) => ({ id: block.id, section: block.section_path })) },
      };
    }

    if (name === "remember_fact") {
      const fact = textArgument(args, "fact", 2_000).replace(/[.!?]+$/, "");
      if (!fact) return { ok: false, summary: "La memoria propuesta está vacía." };
      const block = await recordManualMemoryFact(fact, { source: "zyron-agent-v0.7" });
      await audit("memory_saved", "Guardó una memoria solicitada explícitamente por el propietario.", { memoryBlockId: block.id });
      return { ok: true, summary: `Memoria guardada: ${fact}.`, data: { id: block.id } };
    }

    if (name === "read_calendar") return await readCalendar(args);
    return { ok: false, summary: "Herramienta no implementada." };
  } catch (error) {
    console.error("ZYRON_AGENT_TOOL_ERROR", name, error);
    return { ok: false, summary: `La herramienta ${name} no está disponible temporalmente.` };
  }
}
