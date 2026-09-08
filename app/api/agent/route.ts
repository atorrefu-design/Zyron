import { NextResponse } from "next/server";
import { AIProviderUnavailableError, type ZyronAIMessage } from "../../../lib/ai/router";
import { runZyronAgent } from "../../../lib/agent/runtime";
import { runDeterministicCommand } from "../../../lib/core/deterministic";
import { webLocationObservation, type WebDeviceLocation } from "../../../lib/channels/location";
import { formatWeatherReply, getWeatherForecast, weatherRequestHorizon } from "../../../lib/weather";

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
    const body = (await request.json()) as { messages?: unknown; text?: unknown; channel?: unknown; deviceLocation?: unknown };
    const messages = validMessages(body.messages);
    if (!messages.length && typeof body.text === "string" && body.text.trim()) {
      messages.push({ role: "user", content: body.text.trim().slice(0, 20_000) });
    }
    if (!messages.some((message) => message.role === "user")) {
      return NextResponse.json({ error: "Falta el mensaje del usuario" }, { status: 400 });
    }

    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content || "";
    const channel = body.channel === "ios" || body.channel === "web" ? body.channel : "api";
    const currentLocation = channel === "web" || channel === "ios"
      ? webLocationObservation(body.deviceLocation as WebDeviceLocation | null)
      : null;
    const weatherHorizon = weatherRequestHorizon(lastUserMessage);
    if (weatherHorizon) {
      const latitude = currentLocation?.latitude ?? 41.3874;
      const longitude = currentLocation?.longitude ?? 2.1686;
      const locationLabel = currentLocation ? "tu ubicación actual" : "Barcelona (ubicación de referencia)";
      try {
        const forecast = await getWeatherForecast(latitude, longitude);
        return NextResponse.json({
          reply: formatWeatherReply(forecast, weatherHorizon, locationLabel),
          tool: "weather",
          provider: null,
          model: null,
          creditsUsed: false,
          agent: { version: "0.23", skills: [], steps: 1, toolsUsed: ["get_weather_forecast"] },
        });
      } catch (error) {
        console.error("ZYRON_WEATHER_ROUTE_ERROR", error);
        return NextResponse.json({
          reply: "No he podido consultar ahora mismo el servicio meteorológico. No he usado una estimación ni he inventado la previsión.",
          error: "weather_temporarily_unavailable",
          tool: "weather",
          creditsUsed: false,
        }, { status: 502 });
      }
    }
    const direct = await runDeterministicCommand(lastUserMessage);
    if (direct) {
      return NextResponse.json({
        reply: direct.reply,
        action: direct.action,
        tool: direct.tool,
        provider: null,
        model: null,
        creditsUsed: false,
        agent: { version: "0.23", skills: [], steps: 0, toolsUsed: [direct.tool] },
      });
    }

    const result = await runZyronAgent({ messages, channel, currentLocation });
    return NextResponse.json({
      reply: result.reply,
      provider: result.provider,
      model: result.model,
      routeReason: result.routeReason,
      tool: result.trace.length ? result.trace[result.trace.length - 1].tool : result.memoriesUsed ? "memory" : "conversation",
      memoriesUsed: result.memoriesUsed,
      agent: {
        version: "0.23",
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
