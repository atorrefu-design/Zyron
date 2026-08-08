import { NextResponse } from "next/server";
import { recordAction } from "../../../../lib/db";
import { handleMobilityChat } from "../../../../lib/chat-mobility";

export const runtime = "nodejs";

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages = (body.messages ?? []).filter(
      (message): message is ChatMessage =>
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
    );
    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content?.trim();
    if (!lastUserMessage) return NextResponse.json({ error: "Falta el mensaje del usuario" }, { status: 400 });

    const result = await handleMobilityChat(lastUserMessage);
    if (!result) {
      return NextResponse.json({ error: "mobility_intent_not_detected" }, { status: 400 });
    }

    void recordAction("maps", result.action, "Consultó movilidad desde el chat.", {
      source: "chat",
    }).catch(() => undefined);

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ZYRON_MOBILITY_CHAT_ERROR", error);
    return NextResponse.json({
      reply: "No he podido calcular la movilidad ahora mismo. Prueba de nuevo en unos segundos o abre Movilidad para revisar la ruta.",
      action: "mobility_read_failed",
      tool: "maps",
    });
  }
}
