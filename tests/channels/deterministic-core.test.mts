import assert from "node:assert/strict";
import test from "node:test";
import { resolveDeterministicCommand } from "../../lib/core/deterministic-intent.ts";

test("clear task orders route without a reasoning model", () => {
  assert.deepEqual(resolveDeterministicCommand("¿Qué tareas tengo pendientes?"), { type: "tasks_list" });
  assert.deepEqual(resolveDeterministicCommand("/tarea Comprar pilas"), { type: "task_create", query: "Comprar pilas" });
  assert.deepEqual(resolveDeterministicCommand("Apúntame como tarea llamar al taller"), { type: "task_create", query: "llamar al taller" });
  assert.deepEqual(resolveDeterministicCommand("/completar Comprar pilas"), { type: "task_complete", query: "Comprar pilas" });
});

test("JARVIS operational views route deterministically", () => {
  assert.deepEqual(resolveDeterministicCommand("/briefing"), { type: "briefing" });
  assert.deepEqual(resolveDeterministicCommand("Ponme al día"), { type: "briefing" });
  assert.deepEqual(resolveDeterministicCommand("/actividad"), { type: "activity" });
  assert.deepEqual(resolveDeterministicCommand("¿Funciona todo?"), { type: "diagnostics" });
  assert.deepEqual(resolveDeterministicCommand("Planifica mi día"), { type: "daily_plan" });
});

test("ambiguous conversation still reaches the shared agent", () => {
  assert.equal(resolveDeterministicCommand("Ayúdame a organizar mejor la semana"), null);
  assert.equal(resolveDeterministicCommand("¿Qué opinas de mis prioridades?"), null);
  assert.equal(resolveDeterministicCommand("Borra todas las tareas"), null);
});
