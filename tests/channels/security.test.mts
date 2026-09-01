import assert from "node:assert/strict";
import test from "node:test";
import {
  createPairingCode,
  isValidTelegramWebhookSecret,
  normalizePairingCode,
  parseTelegramCommand,
  secureSecretEquals,
  splitTelegramText,
} from "../../lib/channels/security.ts";

test("webhook secrets require a strong Telegram-safe value", () => {
  assert.equal(isValidTelegramWebhookSecret("telegram_secret-2026_ZYRON"), true);
  assert.equal(isValidTelegramWebhookSecret("short"), false);
  assert.equal(isValidTelegramWebhookSecret("invalid secret with spaces"), false);
  assert.equal(secureSecretEquals("telegram_secret-2026_ZYRON", "telegram_secret-2026_ZYRON"), true);
  assert.equal(secureSecretEquals("telegram_secret-2026_ZYRON", "telegram_secret-2026_other"), false);
  assert.equal(secureSecretEquals("telegram_secret-2026_ZYRON", null), false);
});

test("pairing codes are readable, normalized and high entropy", () => {
  const codes = new Set(Array.from({ length: 64 }, () => createPairingCode()));
  assert.equal(codes.size, 64);
  for (const code of codes) {
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(normalizePairingCode(code).length, 8);
  }
  assert.equal(normalizePairingCode("abcd efgh"), "ABCDEFGH");
});

test("Telegram commands support bot suffixes and arguments", () => {
  assert.deepEqual(parseTelegramCommand("/pair ABCD-EFGH"), { name: "pair", argument: "ABCD-EFGH" });
  assert.deepEqual(parseTelegramCommand("/status@zyron_bot"), { name: "status", argument: "" });
  assert.equal(parseTelegramCommand("hola ZYRON"), null);
});

test("long replies are split without exceeding Telegram limits", () => {
  const paragraph = "ZYRON responde con contexto privado. ".repeat(170);
  const chunks = splitTelegramText(`${paragraph}\n\n${paragraph}`);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 4_000));
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), `${paragraph} ${paragraph}`.replace(/\s+/g, " ").trim());
});
