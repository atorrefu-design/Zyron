import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TELEGRAM_VOICE_BYTES,
  MAX_TELEGRAM_VOICE_SECONDS,
  telegramVoiceValidationMessage,
  validateTelegramVoice,
} from "../../lib/channels/voice-policy.ts";

function voice(overrides: Partial<Parameters<typeof validateTelegramVoice>[0]> = {}) {
  return {
    file_id: "telegram-file-id",
    file_unique_id: "telegram-unique-id",
    duration: 24,
    mime_type: "audio/ogg",
    file_size: 120_000,
    ...overrides,
  };
}

test("accepts an ordinary private Telegram voice note", () => {
  assert.deepEqual(validateTelegramVoice(voice()), { ok: true });
});

test("rejects voice notes that exceed duration or size limits", () => {
  const tooLong = validateTelegramVoice(voice({ duration: MAX_TELEGRAM_VOICE_SECONDS + 1 }));
  const tooLarge = validateTelegramVoice(voice({ file_size: MAX_TELEGRAM_VOICE_BYTES + 1 }));
  assert.deepEqual(tooLong, { ok: false, reason: "too_long" });
  assert.deepEqual(tooLarge, { ok: false, reason: "too_large" });
  assert.match(telegramVoiceValidationMessage(tooLong), /3 minutos/);
  assert.match(telegramVoiceValidationMessage(tooLarge), /8 MB/);
});

test("rejects malformed Telegram voice metadata", () => {
  assert.deepEqual(validateTelegramVoice(voice({ file_id: "" })), { ok: false, reason: "missing_file" });
  assert.deepEqual(validateTelegramVoice(voice({ duration: Number.NaN })), { ok: false, reason: "too_long" });
  assert.deepEqual(validateTelegramVoice(voice({ file_size: -1 })), { ok: false, reason: "too_large" });
});
