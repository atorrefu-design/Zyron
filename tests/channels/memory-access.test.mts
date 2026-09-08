import assert from "node:assert/strict";
import test from "node:test";
import {
  directMemoryQuery,
  looksLikeMemoryWriteRequest,
  renderMemoryPage,
  renderMemorySearch,
  resolveMemoryWriteRequest,
} from "../../lib/channels/memory-access.ts";
import { authorizeAgentTool } from "../../lib/agent/policy.ts";

const block = {
  id: "memory:1",
  document_id: "master",
  heading: "Baloncesto",
  section_path: "Proyectos > Baloncesto",
  content: "Aarón entrena al Junior Masculino de Brafa.",
  position: 1,
  priority: 70,
  always_include: false,
  metadata: {},
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

test("explicit natural-language memory requests are routed without an AI", () => {
  assert.equal(directMemoryQuery("¿Qué recuerdas de mi equipo?"), "mi equipo");
  assert.equal(directMemoryQuery("Qué recuerdas de mi equipo?"), "mi equipo");
  assert.equal(directMemoryQuery("Busca en tu memoria sobre Brafa"), "Brafa");
  assert.equal(directMemoryQuery("Memoria: horarios de trabajo"), "horarios de trabajo");
  assert.equal(directMemoryQuery("Quién ganó el partido"), null);
});

test("memory search renders exact stored blocks and declares zero AI", () => {
  const reply = renderMemorySearch("Brafa", [{ ...block, score: 20 }]);
  assert.match(reply, /Aarón entrena al Junior Masculino de Brafa/);
  assert.match(reply, /Sin IA/);
});

test("full memory can be traversed deterministically by pages", () => {
  const reply = renderMemoryPage({ page: 1, pageSize: 5, totalPages: 2, total: 6, blocks: [block] });
  assert.match(reply, /página 1\/2/);
  assert.match(reply, /\/memoria_toda 2/);
  assert.match(reply, /sin IA/i);
});

test("Telegram saves an explicit fact without invoking the agent", () => {
  const request = resolveMemoryWriteRequest("Guarda en tu memoria que Eloy queda descartado como fichaje", []);
  assert.deepEqual(request, { fact: "Eloy queda descartado como fichaje", source: "explicit" });
  assert.equal(looksLikeMemoryWriteRequest("Guarda en tu memoria que Eloy queda descartado como fichaje"), true);
});

test("Guárdalo en la memoria confirms the previous proposed fact", () => {
  const history = [
    { role: "user" as const, content: "Buenos días. Descartamos el fichaje de Eloy." },
    { role: "assistant" as const, content: "¿Quieres que lo guarde en la memoria de ZYRON?" },
  ];
  assert.deepEqual(resolveMemoryWriteRequest("Guárdalo en la memoria", history), {
    fact: "Descartamos el fichaje de Eloy",
    source: "confirmed_previous",
  });
  assert.equal(authorizeAgentTool("remember_fact", "Guárdalo en la memoria").allowed, true);
});

test("Sí, guarda memoria follows the deterministic Telegram write path", () => {
  const history = [
    { role: "user" as const, content: "Biel estará de baja hasta aproximadamente el 22 de septiembre" },
    { role: "assistant" as const, content: "¿Quieres que lo guarde en la memoria de ZYRON?" },
  ];
  assert.equal(looksLikeMemoryWriteRequest("Sí, guarda memoria"), true);
  assert.deepEqual(resolveMemoryWriteRequest("Sí, guarda memoria", history), {
    fact: "Biel estará de baja hasta aproximadamente el 22 de septiembre",
    source: "confirmed_previous",
  });
  assert.equal(authorizeAgentTool("remember_fact", "Sí, guarda memoria").allowed, true);
});

test("option A retries the original fact instead of saving a confirmation", () => {
  const history = [
    { role: "user" as const, content: "Guarda en tu memoria que Biel volverá aproximadamente el 22 de septiembre" },
    { role: "assistant" as const, content: "No he podido guardar la memoria. Opción A: inténtalo de nuevo." },
    { role: "user" as const, content: "Sí, guarda memoria" },
    { role: "assistant" as const, content: "La API devolvió ok=false. A) Intento de nuevo inmediatamente." },
  ];
  assert.equal(looksLikeMemoryWriteRequest("A"), true);
  assert.deepEqual(resolveMemoryWriteRequest("A", history), {
    fact: "Biel volverá aproximadamente el 22 de septiembre",
    source: "confirmed_previous",
  });
});

test("option A is never treated as memory without a memory prompt", () => {
  const history = [
    { role: "assistant" as const, content: "A) Crear tarea. B) Cancelar." },
  ];
  assert.equal(resolveMemoryWriteRequest("A", history), null);
});

test("a retry recovers the original fact after a failed memory write", () => {
  const history = [
    { role: "user" as const, content: "Descartamos el fichaje de Eloy" },
    { role: "assistant" as const, content: "¿Quieres que lo guarde en la memoria?" },
    { role: "user" as const, content: "Guárdalo en la memoria" },
    { role: "assistant" as const, content: "No se ha guardado. La operación de memoria falló." },
  ];
  assert.deepEqual(resolveMemoryWriteRequest("Inténtalo de nuevo", history), {
    fact: "Descartamos el fichaje de Eloy",
    source: "confirmed_previous",
  });
});

test("generic confirmations never create a memory without a memory prompt", () => {
  const history = [
    { role: "user" as const, content: "Crea una reunión mañana" },
    { role: "assistant" as const, content: "Confirma si creo el evento." },
  ];
  assert.equal(resolveMemoryWriteRequest("Hazlo", history), null);
});
