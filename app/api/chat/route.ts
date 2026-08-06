import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createTask, deleteTask, listTasks, setTaskCompleted } from "../../../lib/db";

export const runtime = "nodejs";

const USER_ID = "aaron";
const AGENT_ID = "zyron";

type ChatMessage = { role: "user" | "assistant"; content: string };
type MemoryResult = { memory?: string };

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

function taskTitleFromMessage(message: string): string | null {
  const patterns = [
    /^recu[eé]rdame\s+(?:que\s+)?(.+)$/i,
    /^apunta(?:me)?\s+(?:como\s+tarea\s+)?(.+)$/i,
    /^a[nñ]ade\s+(?:una\s+)?tarea(?:\s+para)?\s+(.+)$/i,
    /^crea\s+(?:una\s+)?tarea(?:\s+para)?\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const title = message.trim().match(pattern)?.[1]?.trim().replace(/[.!?]+$/, "");
    if (title && title.length <= 240) return title;
  }
  return null;
}

function completionQueryFromMessage(message: string): string | null {
  const patterns = [
    /^(?:marca|pon)\s+(?:como\s+)?(?:hecha|hecho|completada|completado)\s+(.+)$/i,
    /^(?:he\s+)?(?:terminado|completado)\s+(.+)$/i,
    /^completa\s+(?:la\s+tarea\s+)?(.+)$/i,
  ];
  for (const pattern of patterns) {
    const query = message.trim().match(pattern)?.[1]?.trim().replace(/[.!?]+$/, "");
    if (query) return query;
  }
  return null;
}

function deletionQueryFromMessage(message: string): string | null {
  const patterns = [
    /^(?:borra|elimina|quita)\s+(?:la\s+)?tarea\s+(.+)$/i,
    /^(?:borra|elimina|quita)\s+(?:de\s+mis\s+tareas\s+)?(.+)$/i,
  ];
  for (const pattern of patterns) {
    const query = message.trim().match(pattern)?.[1]?.trim().replace(/[.!?]+$/, "");
    if (query) return query;
  }
  return null;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matchingTasks(query: string, tasks: Awaited<ReturnType<typeof listTasks>>) {
  const needle = normalize(query);
  return tasks.filter((task) => normalize(task.title).includes(needle) || needle.includes(normalize(task.title)));
}

function asksForTasks(message: string): boolean {
  return /(?:qu[eé]|cu[aá]les).*(?:tareas|pendientes)|(?:tareas|pendientes).*(?:tengo|hay)/i.test(message);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages = (body.messages ?? []).filter(
      (message): message is ChatMessage => (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
    );
    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content;
    if (!lastUserMessage) return NextResponse.json({ error: "Falta el mensaje del usuario" }, { status: 400 });

    const taskTitle = taskTitleFromMessage(lastUserMessage);
    if (taskTitle) {
      const task = await createTask(taskTitle, null);
      const reply = `Hecho. He añadido “${task.title}” a tus tareas pendientes.`;
      void storeConversation([{ role: "user", content: lastUserMessage }, { role: "assistant", content: reply }]).catch(() => undefined);
      return NextResponse.json({ reply, action: "task_created", task });
    }

    const completionQuery = completionQueryFromMessage(lastUserMessage);
    if (completionQuery) {
      const pending = (await listTasks()).filter((task) => !task.completed);
      const matches = matchingTasks(completionQuery, pending);
      if (matches.length === 1) {
        const task = await setTaskCompleted(matches[0].id, true);
        return NextResponse.json({ reply: `Perfecto. He marcado “${matches[0].title}” como completada.`, action: "task_completed", task });
      }
      if (matches.length > 1) {
        const reply = `He encontrado varias tareas parecidas. Dime cuál:\n${matches.slice(0, 6).map((task, index) => `${index + 1}. ${task.title}`).join("\n")}`;
        return NextResponse.json({ reply, action: "task_completion_ambiguous", tasks: matches.slice(0, 6) });
      }
      return NextResponse.json({ reply: `No encuentro ninguna tarea pendiente que encaje con “${completionQuery}”.`, action: "task_not_found" });
    }

    const deletionQuery = deletionQueryFromMessage(lastUserMessage);
    if (deletionQuery) {
      const tasks = await listTasks();
      const matches = matchingTasks(deletionQuery, tasks);
      if (matches.length === 1) {
        await deleteTask(matches[0].id);
        return NextResponse.json({ reply: `He eliminado la tarea “${matches[0].title}”.`, action: "task_deleted", task: matches[0] });
      }
      if (matches.length > 1) {
        const reply = `Hay varias tareas que encajan. Dime cuál quieres eliminar:\n${matches.slice(0, 6).map((task, index) => `${index + 1}. ${task.title}`).join("\n")}`;
        return NextResponse.json({ reply, action: "task_deletion_ambiguous", tasks: matches.slice(0, 6) });
      }
      return NextResponse.json({ reply: `No encuentro ninguna tarea que encaje con “${deletionQuery}”.`, action: "task_not_found" });
    }

    if (asksForTasks(lastUserMessage)) {
      const pending = (await listTasks()).filter((task) => !task.completed);
      const reply = pending.length
        ? `Tienes ${pending.length} tarea${pending.length === 1 ? "" : "s"} pendiente${pending.length === 1 ? "" : "s"}:\n${pending.slice(0, 12).map((task, index) => `${index + 1}. ${task.title}`).join("\n")}`
        : "No tienes tareas pendientes. Mesa limpia, motor encendido.";
      return NextResponse.json({ reply, action: "tasks_listed", tasks: pending });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY no está configurada" }, { status: 503 });
    const memories = await searchMemories(lastUserMessage);
    const memoryContext = memories.length ? memories.map((memory, index) => `${index + 1}. ${memory}`).join("\n") : "No hay recuerdos relevantes recuperados para este mensaje.";
    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions: [
        "Eres ZYRON, el asistente personal privado de Aarón.",
        "Responde en castellano de España, de forma cercana, directa, honesta y práctica.",
        "No inventes información. Cuando falte un dato, dilo claramente y propón el siguiente paso útil.",
        "Usa los recuerdos como contexto, no los repitas de forma mecánica ni afirmes que son ciertos si contradicen el mensaje actual.",
        "Puedes crear, consultar, completar y eliminar tareas mediante órdenes naturales de Aarón.",
        `Recuerdos relevantes:\n${memoryContext}`,
      ].join("\n\n"),
      input: messages.slice(-12).map((message) => ({ role: message.role, content: message.content })),
    });
    const reply = response.output_text?.trim() || "No he podido construir una respuesta útil.";
    void storeConversation([{ role: "user", content: lastUserMessage }, { role: "assistant", content: reply }]).catch(() => undefined);
    return NextResponse.json({ reply, memoriesUsed: memories.length });
  } catch (error) {
    console.error("ZYRON_CHAT_ERROR", error);
    return NextResponse.json({ error: "Error interno del núcleo de ZYRON" }, { status: 500 });
  }
}
