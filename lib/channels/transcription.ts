import OpenAI from "openai";
import {
  downloadTelegramFile,
  getTelegramFile,
  type TelegramVoice,
} from "./telegram.ts";
import {
  MAX_TELEGRAM_VOICE_BYTES,
  telegramVoiceValidationMessage,
  validateTelegramVoice,
} from "./voice-policy";

export {
  telegramVoiceValidationMessage,
  validateTelegramVoice,
} from "./voice-policy";

function transcriptionClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY no está configurada para transcribir audio");
  return new OpenAI({ apiKey });
}

export async function transcribeTelegramVoice(voice: TelegramVoice) {
  const validation = validateTelegramVoice(voice);
  if (!validation.ok) throw new Error(telegramVoiceValidationMessage(validation));

  const telegramFile = await getTelegramFile(voice.file_id);
  if (!telegramFile.file_path) throw new Error("Telegram no ha entregado la ruta de la nota de voz");
  if (telegramFile.file_size && telegramFile.file_size > MAX_TELEGRAM_VOICE_BYTES) {
    throw new Error("La nota de voz es demasiado grande. El límite de ZYRON es 8 MB.");
  }

  const bytes = await downloadTelegramFile(telegramFile.file_path, MAX_TELEGRAM_VOICE_BYTES);
  const audioFile = new File([bytes], "telegram-voice.ogg", {
    type: voice.mime_type || "audio/ogg",
  });
  const transcription = await transcriptionClient().audio.transcriptions.create({
    file: audioFile,
    model: process.env.ZYRON_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
    language: "es",
    prompt: "ZYRON, Aarón, Maninter, Brafa, ASVALL, Sarai, Barcelona.",
  });
  const text = transcription.text?.trim().slice(0, 4_096) || "";
  if (!text) throw new Error("No he detectado voz comprensible en el audio");
  return text;
}
