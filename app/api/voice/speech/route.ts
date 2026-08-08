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
      response_format: "mp3",
    });

    const audio = Buffer.from(await speech.arrayBuffer());
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "Content-Length": String(audio.byteLength),
      },
    });
  } catch (error) {
    console.error("ZYRON_TTS_ERROR", error);
    return Response.json({ error: "speech_generation_failed" }, { status: 500 });
  }
}
