import OpenAI from "openai";
import { NextResponse } from "next/server";

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
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      filters: { user_id: USER_ID },
      top_k: 8,
      threshold: 0.2,
      rerank: true,
    }),
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
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      user_id: USER_ID,
      agent_id: AGENT_ID,
      metadata: { source: "zyron-web" },
      custom_instructions:
        "Guarda únicamente hechos, preferencias, objetivos, rutinas, proyectos y decisiones útiles a largo plazo sobre Aarón. No guardes saludos, texto transitorio ni secretos.",
    }),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages = (body.messages ?? []).filter(
      (message): message is ChatMessage =>
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
    );

    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content;
    if (!lastUserMessage) {
      return NextResponse.json({ error: "Falta el mensaje del usuario" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY no está configurada" }, { status: 503 });
    }

    const memories = await searchMemories(lastUserMessage);
    const memoryContext = memories.length
      ? memories.map((memory, index) => `${index + 1}. ${memory}`).join("\n")
      : "No hay recuerdos relevantes recuperados para este mensaje.";

    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions: [
        "Eres ZYRON, el asistente personal privado de Aarón.",
        "Responde en castellano de España, de forma cercana, directa, honesta y práctica.",
        "No inventes información. Cuando falte un dato, dilo claramente y propone el siguiente paso útil.",
        "Usa los recuerdos como contexto, no los repitas de forma mecánica ni afirmes que son ciertos si contradicen el mensaje actual.",
        `Recuerdos relevantes:\n${memoryContext}`,
      ].join("\n\n"),
      input: messages.slice(-12).map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });

    const reply = response.output_text?.trim() || "No he podido construir una respuesta útil.";
    void storeConversation([
      { role: "user", content: lastUserMessage },
      { role: "assistant", content: reply },
    ]).catch(() => undefined);

    return NextResponse.json({ reply, memoriesUsed: memories.length });
  } catch (error) {
    console.error("ZYRON_CHAT_ERROR", error);
    return NextResponse.json({ error: "Error interno del núcleo de ZYRON" }, { status: 500 });
  }
}
