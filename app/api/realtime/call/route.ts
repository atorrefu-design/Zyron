export const runtime = "nodejs";

const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime/calls";

function getApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("openai_api_key_missing");
  return apiKey;
}

const realtimeSession = {
  type: "realtime",
  model: "gpt-realtime-2.1-mini",
  output_modalities: ["audio"],
  instructions: [
    "Eres ZYRON, el asistente personal de Aarón.",
    "Habla siempre en español de España salvo que Aarón cambie de idioma.",
    "Conversa como una persona, no como un locutor ni como un asistente telefónico.",
    "Usa frases naturales, contracciones y pausas breves. Evita enumeraciones rígidas salvo que hagan falta.",
    "Responde de forma breve por defecto para que la conversación avance rápido.",
    "Empieza a responder en cuanto tengas suficiente contexto. No introduzcas la respuesta con fórmulas ceremoniosas.",
    "Si Aarón te interrumpe, deja de hablar inmediatamente y escucha el nuevo turno.",
    "No inventes datos privados, de agenda, correo, tareas, tráfico o memoria. Para esos datos usa consultar_nucleo_zyron.",
    "Si una petición requiere datos actuales o privados de ZYRON, llama a consultar_nucleo_zyron y después contesta de forma natural, sin mencionar la herramienta.",
    "Cuando Aarón pida tiendas, restaurantes, negocios, servicios o lugares físicos reales, usa buscar_lugares_reales. Nunca inventes una dirección ni afirmes que un negocio existe sin consultar esa herramienta.",
    "Si Aarón indica una ciudad, barrio o zona, basta con esa ubicación para buscar lugares reales; no le exijas una calle concreta. Si dice cerca de mí, usa la búsqueda de lugares y deja que ZYRON aplique la ubicación actual del iPhone.",
    "Al hablar de resultados de lugares, di nombre y dirección de forma natural. No leas URLs salvo que Aarón las pida.",
  ].join(" "),
  audio: {
    input: {
      noise_reduction: { type: "near_field" },
      turn_detection: {
        type: "server_vad",
        threshold: 0.45,
        prefix_padding_ms: 250,
        silence_duration_ms: 420,
        create_response: true,
        interrupt_response: true,
      },
    },
    output: {
      voice: "marin",
    },
  },
  tools: [
    {
      type: "function",
      name: "consultar_nucleo_zyron",
      description: "Consulta el núcleo privado de ZYRON cuando Aarón pide datos personales o actuales: agenda, Gmail, tareas, briefing, tráfico, rutas, hora de salida, objetivos, memoria o estado del sistema. No usar para charla general ni para buscar negocios físicos.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "La petición completa de Aarón, conservando fechas, horas, nombres y contexto relevante.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "buscar_lugares_reales",
      description: "Busca negocios y lugares físicos reales en Google Places, con nombre y dirección verificados. Usar para tiendas, restaurantes, talleres, supermercados, servicios, locales y cualquier petición de lugares en una ciudad, barrio o cerca de la ubicación actual.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Qué lugar busca Aarón y la zona indicada, por ejemplo: tiendas de zapatillas en Badalona, farmacia cerca de mí o restaurantes japoneses en Sabadell.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  ],
  tool_choice: "auto",
};

function safeUpstreamError(status: number, raw: string) {
  let code = "";
  let message = "";
  try {
    const data = JSON.parse(raw) as { error?: { code?: string; message?: string; type?: string } };
    code = data.error?.code || data.error?.type || "";
    message = data.error?.message || "";
  } catch {
    message = "";
  }

  if (status === 401) return { code: "openai_key_rejected", message: "OpenAI ha rechazado la clave API." };
  if (status === 402) return { code: "openai_quota_exhausted", message: "La cuenta API no tiene crédito disponible." };
  if (status === 403) return { code: code || "openai_realtime_forbidden", message: "La cuenta API no tiene acceso a este modelo Realtime." };
  if (status === 429) return { code: code || "openai_rate_limited", message: "OpenAI está limitando temporalmente las sesiones Realtime." };
  if (status >= 500) return { code: "openai_realtime_unavailable", message: "OpenAI Realtime no está disponible temporalmente." };

  const cleanMessage = message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return {
    code: code || `openai_http_${status}`,
    message: cleanMessage || "OpenAI no ha aceptado la configuración de la sesión Realtime.",
  };
}

export async function POST(request: Request) {
  try {
    const sdp = await request.text();
    if (!sdp.trim()) {
      return Response.json({ error: "realtime_sdp_required" }, { status: 400 });
    }

    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(realtimeSession));

    const response = await fetch(OPENAI_REALTIME_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: form,
      cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
      const safe = safeUpstreamError(response.status, text);
      console.error("ZYRON_REALTIME_CALL_ERROR", response.status, safe.code, safe.message);
      return Response.json(
        { error: "realtime_call_failed", upstreamStatus: response.status, code: safe.code, detail: safe.message },
        { status: 502 },
      );
    }

    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store",
        "X-Zyron-Realtime-Model": "gpt-realtime-2.1-mini",
      },
    });
  } catch (error) {
    const detail = error instanceof Error && error.message === "openai_api_key_missing"
      ? "Falta OPENAI_API_KEY en el servidor."
      : "No se ha podido crear la sesión Realtime.";
    console.error("ZYRON_REALTIME_CALL_ERROR", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "realtime_call_failed", code: "zyron_realtime_server_error", detail }, { status: 500 });
  }
}
