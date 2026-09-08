import OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import {
  AIProviderUnavailableError,
  resolveAISelection,
  type ZyronAIMessage,
  type ZyronAIProvider,
} from "../ai/router";
import { buildMemoryContext } from "../memory";
import { toolSummary } from "../tools/registry";
import { renderAgentSkills, selectAgentSkills } from "./skills";
import { agentToolDefinitions, executeAgentTool } from "./tools";
import { agentLocationContext, type CurrentChannelLocation } from "../channels/location.ts";

const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

export type ZyronAgentTrace = {
  step: number;
  tool: string;
  ok: boolean;
  summary: string;
};

export type ZyronAgentResult = {
  reply: string;
  provider: ZyronAIProvider;
  model: string;
  routeReason: "default" | "explicit" | "automatic";
  skills: string[];
  trace: ZyronAgentTrace[];
  memoriesUsed: number;
};

export type ZyronAgentChannel = "web" | "ios" | "telegram" | "api";

function clientFor(provider: ZyronAIProvider) {
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AIProviderUnavailableError(provider);
    return new OpenAI({ apiKey });
  }
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new AIProviderUnavailableError(provider);
  return new OpenAI({ apiKey, baseURL: AI_GATEWAY_BASE_URL });
}

function recentMessages(messages: ZyronAIMessage[], prompt: string): ChatCompletionMessageParam[] {
  const recent = messages.slice(-16).map((message) => ({ ...message }));
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index].role === "user") {
      recent[index].content = prompt;
      break;
    }
  }
  return recent.map((message) => ({ role: message.role, content: message.content }));
}

function maxAgentSteps() {
  const configured = Number(process.env.ZYRON_AGENT_MAX_STEPS || 4);
  return Math.max(1, Math.min(Number.isFinite(configured) ? configured : 4, 6));
}

function systemInstructions(input: {
  skills: ReturnType<typeof selectAgentSkills>;
  memory: string;
  currentLocation?: CurrentChannelLocation | null;
  channel: ZyronAgentChannel;
}) {
  return [
    "# Núcleo único ZYRON v0.18",
    `Canal actual: ${input.channel}. El canal es solo una interfaz: conserva la misma identidad, memoria, herramientas y políticas de ZYRON.`,
    "Resuelve la petición completa con el mínimo número de pasos útiles.",
    "Usa herramientas para datos reales o acciones. No inventes resultados de herramientas.",
    "Si una herramienta devuelve ok=false, explica el bloqueo concreto y no afirmes que la acción se completó.",
    "Para crear o eliminar un evento, borrar una tarea o escribir en Drive, muestra primero un resumen claro y pide confirmación. Solo llama a la herramienta cuando el último mensaje de Aarón confirme la acción.",
    "La eliminación de eventos solo afecta a Google Calendar. No hay herramientas de envío de mensajes ni cambios de permisos en este núcleo.",
    input.channel === "telegram"
      ? "Desde Telegram ejecuta todas las capacidades de servidor disponibles. Las acciones exclusivas del dispositivo (abrir apps, iniciar llamadas/SMS/WhatsApp, grabar audio o lanzar notificaciones nativas) requieren el companion de ZYRON en el iPhone: no afirmes que se han ejecutado y explica el límite con una alternativa útil."
      : "No afirmes haber ejecutado una acción nativa del dispositivo si el resultado de la capa nativa no está presente.",
    "Aarón ha desactivado todos los procesos en segundo plano. No programes ni ofrezcas reintentos automáticos, tareas automáticas, avisos o seguimientos salvo que él lo solicite expresamente.",
    `Fecha y hora actual de referencia: ${new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "full", timeStyle: "long" }).format(new Date())}.`,
    "Cuando ya tengas el resultado, responde directamente sin describir tu razonamiento interno.",
    `\n# Skills activas\n${renderAgentSkills(input.skills)}`,
    `\n# Capacidades registradas\n${toolSummary()}`,
    `\n# Memoria privada recuperada\n${input.memory}`,
    `\n# Contexto temporal de ubicación\n${agentLocationContext(input.currentLocation || null)}`,
  ].join("\n\n");
}

export async function runZyronAgent(input: {
  messages: ZyronAIMessage[];
  currentLocation?: CurrentChannelLocation | null;
  channel?: ZyronAgentChannel;
}): Promise<ZyronAgentResult> {
  const lastUserMessage = [...input.messages].reverse().find((message) => message.role === "user")?.content?.trim();
  if (!lastUserMessage) throw new Error("Falta el mensaje del usuario");

  const selection = resolveAISelection(lastUserMessage);
  const skills = selectAgentSkills(selection.prompt);
  const memory = await buildMemoryContext(selection.prompt, 14_000).catch((error) => {
    console.error("ZYRON_AGENT_MEMORY_ERROR", error);
    return { context: "La memoria privada no está disponible temporalmente.", blocks: [] };
  });
  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: systemInstructions({
      skills,
      memory: memory.context,
      currentLocation: input.currentLocation,
      channel: input.channel || "api",
    }) },
    ...recentMessages(input.messages, selection.prompt),
  ];
  const client = clientFor(selection.provider);
  const trace: ZyronAgentTrace[] = [];

  for (let step = 1; step <= maxAgentSteps(); step += 1) {
    const response = await client.chat.completions.create({
      model: selection.model,
      messages: conversation,
      tools: agentToolDefinitions,
      tool_choice: "auto",
    });
    const message = response.choices[0]?.message;
    if (!message) throw new Error("El motor no ha devuelto ningún mensaje");
    const functionCalls = (message.tool_calls ?? []).filter((call) => call.type === "function");

    if (!functionCalls.length) {
      return {
        reply: message.content?.trim() || "No he podido construir una respuesta útil.",
        provider: selection.provider,
        model: selection.model,
        routeReason: selection.routeReason,
        skills: skills.map((skill) => skill.id),
        trace,
        memoriesUsed: memory.blocks.length,
      };
    }

    const assistantMessage: ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: message.content ?? null,
      tool_calls: functionCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.function.name, arguments: call.function.arguments },
      })),
    };
    conversation.push(assistantMessage);

    for (const call of functionCalls) {
      const result = await executeAgentTool({
        name: call.function.name,
        arguments: call.function.arguments,
        userMessage: selection.prompt,
      });
      trace.push({ step, tool: call.function.name, ok: result.ok, summary: result.summary });
      conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  conversation.push({
    role: "system",
    content: "Has alcanzado el límite de pasos. Da ahora la mejor respuesta posible con los resultados disponibles, sin llamar a más herramientas.",
  });
  const finalResponse = await client.chat.completions.create({ model: selection.model, messages: conversation });
  return {
    reply: finalResponse.choices[0]?.message?.content?.trim() || "He agotado el límite de ejecución sin un resultado concluyente.",
    provider: selection.provider,
    model: selection.model,
    routeReason: selection.routeReason,
    skills: skills.map((skill) => skill.id),
    trace,
    memoriesUsed: memory.blocks.length,
  };
}
