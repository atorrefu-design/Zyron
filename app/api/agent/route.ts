import { NextResponse } from "next/server";
import { AIProviderUnavailableError, type ZyronAIMessage } from "../../../lib/ai/router";
import { runZyronAgent } from "../../../lib/agent/runtime";
import { runDeterministicCommand } from "../../../lib/core/deterministic";

export const runtime = "nodejs";
export const maxDuration = 60;

function validMessages(value: unknown): ZyronAIMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((message): message is ZyronAIMessage => Boolean(
    message
      && typeof message === "object"
      && ((message as { role?: unknown }).role === "user" || (message as { role?: unknown }).role === "assistant")
      && typeof (message as { content?: unknown }).content === "string",
  )).map((message) => ({ role: message.role, content: message.content.slice(0, 20_000) }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: unknown; text?: unknown; channel?: unknown };
    const messages = validMessages(body.messages);
    if (!messages.length && typeof body.text === "string" && body.text.trim()) {
      messages.push({ role: "user", content: body.text.trim().slice(0, 20_000) });
    }
    if (!messages.some((message) => message.role === "user")) {
      return NextResponse.json({ error: "Falta el mensaje del usuario" }, { status: 400 });
    }

    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content || "";
    const direct = await runDeterministicCommand(lastUserMessage);
    if (direct) {
      return NextResponse.json({
        reply: direct.reply,
        action: direct.action,
        tool: direct.tool,
        provider: null,
        model: null,
        creditsUsed: false,
        agent: { version: "0.20", skills: [], steps: 0, toolsUsed: [direct.tool] },
      });
    }

    const channel = body.channel === "ios" || body.channel === "web" ? body.channel : "api";
    const result = await runZyronAgent({ messages, channel });
    return NextResponse.json({
      reply: result.reply,
      provider: result.provider,
      model: result.model,
      routeReason: result.routeReason,
      tool: result.trace.length ? result.trace[result.trace.length - 1].tool : result.memoriesUsed ? "memory" : "conversation",
      memoriesUsed: result.memoriesUsed,
      agent: {
        version: "0.18",
        skills: result.skills,
        steps: result.trace.length,
        toolsUsed: result.trace.map((item) => item.tool),
      },
    });
  } catch (error) {
    if (error instanceof AIProviderUnavailableError) {
      return NextResponse.json({
        reply: error.message,
        action: "ai_provider_unavailable",
        provider: error.provider,
        tool: "conversation",
      });
    }
    console.error("ZYRON_AGENT_ROUTE_ERROR", error);
    return NextResponse.json({ error: "Error interno del núcleo agente de ZYRON" }, { status: 500 });
  }
}
