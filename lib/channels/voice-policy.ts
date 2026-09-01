export const MAX_TELEGRAM_VOICE_BYTES = 8 * 1024 * 1024;
export const MAX_TELEGRAM_VOICE_SECONDS = 3 * 60;

export type TelegramVoiceMetadata = {
  file_id: string;
  duration: number;
  file_size?: number;
};

export type TelegramVoiceValidation =
  | { ok: true }
  | { ok: false; reason: "missing_file" | "too_large" | "too_long" };

export function validateTelegramVoice(voice: TelegramVoiceMetadata): TelegramVoiceValidation {
  if (!voice.file_id?.trim()) return { ok: false, reason: "missing_file" };
  if (!Number.isFinite(voice.duration) || voice.duration < 0 || voice.duration > MAX_TELEGRAM_VOICE_SECONDS) {
    return { ok: false, reason: "too_long" };
  }
  if (voice.file_size !== undefined && (!Number.isFinite(voice.file_size) || voice.file_size < 0 || voice.file_size > MAX_TELEGRAM_VOICE_BYTES)) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true };
}

export function telegramVoiceValidationMessage(validation: TelegramVoiceValidation) {
  if (validation.ok) return "";
  if (validation.reason === "too_long") return "La nota de voz supera los 3 minutos. Envíamela dividida en mensajes más cortos.";
  if (validation.reason === "too_large") return "La nota de voz es demasiado grande. El límite de ZYRON es 8 MB.";
  return "No he podido identificar el archivo de la nota de voz.";
}
