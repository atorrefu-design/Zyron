import { createHash, randomInt, timingSafeEqual } from "node:crypto";

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TELEGRAM_SECRET_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

export function secureSecretEquals(expected: string, received: string | null) {
  if (!received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function isValidTelegramWebhookSecret(value: string) {
  return TELEGRAM_SECRET_PATTERN.test(value);
}

export function normalizePairingCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

export function createPairingCode() {
  let compact = "";
  for (let index = 0; index < 8; index += 1) {
    compact += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export function hashPairingCode(value: string) {
  return createHash("sha256").update(normalizePairingCode(value)).digest("hex");
}

export function parseTelegramCommand(text: string) {
  const match = text.trim().match(/^\/([a-z_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { name: match[1].toLowerCase(), argument: match[2]?.trim() || "" };
}

export function splitTelegramText(value: string, limit = 4_000) {
  const safeLimit = Math.max(32, Math.min(limit, 4_000));
  const text = value.trim() || "No he podido construir una respuesta útil.";
  if (text.length <= safeLimit) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > safeLimit) {
    const window = remaining.slice(0, safeLimit + 1);
    const paragraphBreak = window.lastIndexOf("\n\n");
    const lineBreak = window.lastIndexOf("\n");
    const space = window.lastIndexOf(" ");
    const splitAt = paragraphBreak > safeLimit * 0.55
      ? paragraphBreak
      : lineBreak > safeLimit * 0.65
        ? lineBreak
        : space > safeLimit * 0.75
          ? space
          : safeLimit;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
