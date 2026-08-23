import OpenAI from "openai";

export type ZyronAIProvider = "openai" | "claude" | "gemini";
export type ZyronAIRouteReason = "default" | "explicit" | "automatic";
export type ZyronAIMessage = { role: "user" | "assistant"; content: string };

export type ZyronAISelection = {
  provider: ZyronAIProvider;
  model: string;
  prompt: string;
  routeReason: ZyronAIRouteReason;
};

export type ZyronAIProviderStatus = {
  provider: ZyronAIProvider;
  configured: boolean;
  model: string;
  transport: "direct" | "vercel-ai-gateway";
};

const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const DEFAULT_CLAUDE_MODEL = "anthropic/claude-haiku-4.5";
const DEFAULT_GEMINI_MODEL = "google/gemini-3.1-flash-lite";

const PROVIDER_DIRECTIVES = [
  /^(?:usa|utiliza|emplea)\s+(openai|chatgpt|claude|gemini)(?:\s+para\s+(?:responder|contestar))?\s*(?:[:,.\-–—]\s*|\s+)([\s\S]+)$/i,
  /^(?:pregunta(?:le)?|consulta)\s+(?:a|con)\s+(openai|chatgpt|claude|gemini)\s*(?:[:,.\-–—]\s*|\s+)([\s\S]+)$/i,
  /^(?:responde|contesta|hazlo)\s+(?:con|usando)\s+(openai|chatgpt|claude|gemini)\s*(?:[:,.\-–—]\s*|\s+)([\s\S]+)$/i,
  /^(?:con\s+)?(openai|chatgpt|claude|gemini)\s*[:,.\-–—]\s*([\s\S]+)$/i,
];

function normalizeProvider(value: string): ZyronAIProvider {
  return /^(?:openai|chatgpt)$/i.test(value) ? "openai" : value.toLowerCase() as ZyronAIProvider;
}

function modelFor(provider: ZyronAIProvider) {
  if (provider === "claude") return process.env.ZYRON_CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
  if (provider === "gemini") return process.env.ZYRON_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  return process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

function automaticProvider(prompt: string): ZyronAIProvider | null {
  if (process.env.ZYRON_AI_ROUTER_MODE?.trim().toLowerCase() !== "auto") return null;
  const clean = prompt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(imagen|foto|captura|video|multimodal)\b/.test(clean)) return "gemini";
  if (/\b(analiza|razona|compara|documento|contrato|informe extenso|plan detallado)\b/.test(clean)) return "claude";
  return null;
}

export function resolveAISelection(message: string): ZyronAISelection {
  const original = message.trim();
  for (const pattern of PROVIDER_DIRECTIVES) {
    const match = original.match(pattern);
    const prompt = match?.[2]?.trim();
    if (match?.[1] && prompt) {
      const provider = normalizeProvider(match[1]);
      return { provider, model: modelFor(provider), prompt, routeReason: "explicit" };
    }
  }

  const automatic = automaticProvider(original);
  if (automatic) {
    return { provider: automatic, model: modelFor(automatic), prompt: original, routeReason: "automatic" };
  }

  return { provider: "openai", model: modelFor("openai"), prompt: original, routeReason: "default" };
}

export function getAIProviderStatuses(): ZyronAIProviderStatus[] {
  const gatewayConfigured = Boolean(process.env.AI_GATEWAY_API_KEY);
  return [
    {
      provider: "openai",
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: modelFor("openai"),
      transport: "direct",
    },
    {
      provider: "claude",
      configured: gatewayConfigured,
      model: modelFor("claude"),
      transport: "vercel-ai-gateway",
    },
    {
      provider: "gemini",
      configured: gatewayConfigured,
      model: modelFor("gemini"),
      transport: "vercel-ai-gateway",
    },
  ];
}

export class AIProviderUnavailableError extends Error {
  readonly provider: ZyronAIProvider;

  constructor(provider: ZyronAIProvider) {
    super(provider === "openai"
      ? "OpenAI no está configurado en ZYRON."
      : `${provider === "claude" ? "Claude" : "Gemini"} todavía no está conectado. Falta configurar AI_GATEWAY_API_KEY en Vercel.`);
    this.provider = provider;
    this.name = "AIProviderUnavailableError";
  }
}

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

function messagesWithPrompt(messages: ZyronAIMessage[], prompt: string) {
  const recent = messages.slice(-12).map((message) => ({ ...message }));
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index].role === "user") {
      recent[index].content = prompt;
      return recent;
    }
  }
  return [{ role: "user" as const, content: prompt }];
}

export async function generateZyronReply(input: {
  selection: ZyronAISelection;
  instructions: string;
  messages: ZyronAIMessage[];
}) {
  const client = clientFor(input.selection.provider);
  const response = await client.responses.create({
    model: input.selection.model,
    instructions: input.instructions,
    input: messagesWithPrompt(input.messages, input.selection.prompt),
  });

  return {
    text: response.output_text?.trim() || "No he podido construir una respuesta útil.",
    provider: input.selection.provider,
    model: input.selection.model,
    routeReason: input.selection.routeReason,
  };
}
