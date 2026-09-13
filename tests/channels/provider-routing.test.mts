import test from "node:test";
import assert from "node:assert/strict";
import { clientFor, getAIProviderStatuses, resolveAISelection } from "../../lib/ai/router.ts";

test("provider routing honours explicit local requests without cloud fallback", () => {
  const before = { ...process.env };
  try {
    delete process.env.ZYRON_LOCAL_BASE_URL;
    delete process.env.ZYRON_LOCAL_MODEL;
    assert.equal(resolveAISelection("local: prepara un resumen").provider, "local");
    assert.throws(() => clientFor("local"), /servidor local/);
    assert.equal(getAIProviderStatuses().find((p) => p.provider === "local")?.configured, false);
    process.env.ZYRON_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
    process.env.ZYRON_LOCAL_MODEL = "test-model";
    process.env.ZYRON_DEFAULT_AI_PROVIDER = "local";
    assert.equal(resolveAISelection("Hola").model, "test-model");
    assert.equal(clientFor("local").baseURL, "http://127.0.0.1:11434/v1");
  } finally { process.env = before; }
});

test("a direct Gemini key routes to Google instead of the paid gateway", () => {
  const before = { ...process.env };
  try {
    process.env.GEMINI_API_KEY = "test-not-a-real-key";
    process.env.ZYRON_GEMINI_DIRECT_MODEL = "gemini-test";
    const selection = resolveAISelection("gemini: hola");
    assert.equal(selection.model, "gemini-test");
    assert.equal(clientFor("gemini").baseURL, "https://generativelanguage.googleapis.com/v1beta/openai/");
    assert.equal(getAIProviderStatuses().find((p) => p.provider === "gemini")?.transport, "direct");
  } finally { process.env = before; }
});
