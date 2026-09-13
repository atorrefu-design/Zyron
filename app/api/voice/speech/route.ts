import { ZYRON_VOICE_STYLE } from "../../../../lib/persona";
import OpenAI from "openai";

export const runtime = "nodejs";

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("openai_api_key_missing");
  if (!apiKey.startsWith("sk-")) throw new Error("openai_api_key_invalid_format");
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

function errorStatus(error: unknown) {
  return error instanceof Error && "status" in error
    ? Number((error as Error & { status?: number }).status || 0)
    : 0;
}

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error
    ? String((error as Error & { code?: string }).code || "")
    : "";
}

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "voice_error_unknown";
  const status = errorStatus(error);
  const code = errorCode(error);
  if (error.message === "openai_api_key_missing") return "openai_api_key_missing";
  if (error.message === "openai_api_key_invalid_format") return "openai_api_key_invalid_format";
  if (status === 401 || code === "invalid_api_key") return "openai_api_key_rejected";
  if (code === "insufficient_quota") return "openai_quota_exhausted";
  if (status === 429) return "openai_rate_limited";
  if (status >= 500) return "openai_service_unavailable";
  return "speech_generation_failed";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SpeechResult = {
  response: Awaited<ReturnType<OpenAI["audio"]["speech"]["create"]>>;
  model: "gpt-4o-mini-tts" | "tts-1";
};

async function createPrimarySpeech(client: OpenAI, input: string) {
  const delays = [500, 1200];
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await client.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "cedar",
        input,
        instructions: ZYRON_VOICE_STYLE,
        response_format: "wav",
      });
    } catch (error) {
      lastError = error;
      const retryable = errorStatus(error) === 429 && errorCode(error) !== "insufficient_quota";
      if (!retryable || attempt === delays.length) throw error;
      await wait(delays[attempt]);
    }
  }

  throw lastError;
}

async function createLegacySpeech(client: OpenAI, input: string) {
  return client.audio.speech.create({
    model: "tts-1",
    voice: "onyx",
    input,
    response_format: "wav",
  });
}

async function createSpeech(client: OpenAI, input: string): Promise<SpeechResult> {
  try {
    return { response: await createPrimarySpeech(client, input), model: "gpt-4o-mini-tts" };
  } catch (primaryError) {
    const canFallback = errorStatus(primaryError) === 429 && errorCode(primaryError) !== "insufficient_quota";
    if (!canFallback) throw primaryError;

    try {
      return { response: await createLegacySpeech(client, input), model: "tts-1" };
    } catch (fallbackError) {
      throw fallbackError;
    }
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: string };
    const input = cleanSpeechText(body.text);
    if (!input) return Response.json({ error: "speech_text_required" }, { status: 400 });

    const { response: speech, model } = await createSpeech(getOpenAI(), input);
    const audio = Buffer.from(await speech.arrayBuffer());
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "Content-Length": String(audio.byteLength),
        "X-Zyron-Voice": "tts-ok",
        "X-Zyron-Voice-Model": model,
      },
    });
  } catch (error) {
    const detail = safeError(error);
    console.error("ZYRON_TTS_ERROR", detail);
    const status = detail.startsWith("openai_api_key_")
      ? 503
      : detail === "openai_quota_exhausted"
        ? 402
        : detail === "openai_rate_limited"
          ? 429
          : 500;
    return Response.json({ error: "speech_generation_failed", detail }, { status });
  }
}
