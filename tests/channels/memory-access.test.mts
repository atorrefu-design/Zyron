import assert from "node:assert/strict";
import test from "node:test";
import {
  directMemoryQuery,
  renderMemoryPage,
  renderMemorySearch,
} from "../../lib/channels/memory-access.ts";

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
