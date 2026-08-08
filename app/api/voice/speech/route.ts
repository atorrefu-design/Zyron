import OpenAI from "openai";

export const runtime = "nodejs";

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("openai_api_key_missing");
  return new OpenAI({ apiKey });
}

function cleanSpeechText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[⭐●•▪◦]/g, "")
    .replace(/^\s*\d+[.)]\s*/gm, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3500);
}

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "unknown_voice_error";
  const status = "status" in error ? Number((error as Error & { status?: number }).status || 0) : 0;
  const code = "code" in error ? String((error as Error & { code?: string }).code || "") : "";
  const message = error.message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 220);
  return [status ? `http_${status}` : "", code, message].filter(Boolean).join(": ");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: string };
    const input = cleanSpeechText(body.text);
    if (!input) return Response.json({ error: "speech_text_required" }, { status: 400 });

    const speech = await getOpenAI().audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "cedar",
      input,
      instructions: "Habla en español de España, con una voz natural, cercana y segura. Ritmo conversacional, sin sonar teatral. Pronuncia horas, direcciones y cifras con claridad.",
      response_format: "wav",
    });

    const audio = Buffer.from(await speech.arrayBuffer());
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "Content-Length": String(audio.byteLength),
        "X-Zyron-Voice": "tts-ok",
      },
    });
  } catch (error) {
    const detail = safeError(error);
    console.error("ZYRON_TTS_ERROR", detail);
    return Response.json({ error: "speech_generation_failed", detail }, { status: 500 });
  }
}
