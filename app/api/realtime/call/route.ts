export const runtime = "nodejs";

const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime/calls";

function getApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("openai_api_key_missing");
  return apiKey;
}

const realtimeSession = {
  type: "realtime",
  model: "gpt-realtime",
  output_modalities: ["audio"],
  instructions: [
    "Eres ZYRON, el asistente personal de Aarón.",
    "Habla siempre en español de España salvo que Aarón cambie de idioma.",
    "Tu voz debe sonar humana, cercana, ágil y espontánea. Evita tono de locutor, frases ceremoniosas y listas recitadas salvo que sean útiles.",
    "Usa respuestas habladas relativamente breves por defecto y amplía cuando Aarón lo pida.",
    "Varía la entonación de forma natural. No leas signos, markdown, URLs ni encabezados como si fueran texto corrido.",
    "Si Aarón empieza a hablar mientras respondes, deja de hablar y escúchale. La conversación debe poder encadenar turnos sin pulsar de nuevo el botón.",
    "No inventes datos privados, de agenda, correo, tareas, tráfico o memoria. Para esos datos usa consultar_nucleo_zyron.",
    "Si una petición requiere datos actuales o privados de ZYRON, llama a consultar_nucleo_zyron y después explica el resultado de forma natural, sin decir que has usado una herramienta.",
  ].join(" "),
  max_output_tokens: 700,
  audio: {
    input: {
      noise_reduction: { type: "near_field" },
      transcription: {
        model: "gpt-4o-mini-transcribe",
        language: "es",
        prompt: "Conversación en español de España con el asistente personal ZYRON. El usuario se llama Aarón.",
      },
      turn_detection: {
        type: "server_vad",
        threshold: 0.45,
        prefix_padding_ms: 250,
        silence_duration_ms: 380,
        create_response: true,
        interrupt_response: true,
      },
    },
    output: {
      voice: "marin",
      speed: 1.04,
    },
  },
  tools: [
    {
      type: "function",
      name: "consultar_nucleo_zyron",
      description: "Consulta el núcleo privado de ZYRON cuando Aarón pide datos personales o actuales: agenda, Gmail, tareas, briefing, tráfico, rutas, hora de salida, objetivos, memoria o estado del sistema. No usar para charla general.",
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
  ],
  tool_choice: "auto",
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sdp?: string };
    if (!body.sdp?.trim()) {
      return Response.json({ error: "realtime_sdp_required" }, { status: 400 });
    }

    const form = new FormData();
    form.set("sdp", new Blob([body.sdp], { type: "application/sdp" }), "offer.sdp");
    form.set("session", new Blob([JSON.stringify(realtimeSession)], { type: "application/json" }), "session.json");

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
      console.error("ZYRON_REALTIME_CALL_ERROR", response.status, text.slice(0, 240));
      return Response.json({ error: "realtime_call_failed", status: response.status }, { status: 502 });
    }

    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("ZYRON_REALTIME_CALL_ERROR", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "realtime_call_failed" }, { status: 500 });
  }
}
