import assert from "node:assert/strict";
import test from "node:test";
import { authorizeAgentTool, listAgentToolPolicies } from "../../lib/agent/policy.ts";
import { renderTelegramCapabilities, telegramCapabilityMatrix } from "../../lib/channels/parity.ts";

test("Telegram's shared agent exposes the priority server capabilities", () => {
  const names = new Set(Object.keys(listAgentToolPolicies()));
  for (const name of [
    "list_tasks", "create_task", "complete_task", "delete_task", "search_memory",
    "remember_fact", "read_calendar", "search_gmail", "search_drive",
    "get_driving_route", "search_current_web",
  ]) {
    assert.equal(names.has(name), true, `${name} should be exposed`);
  }
});

test("task deletion is blocked until a later explicit confirmation", () => {
  assert.equal(authorizeAgentTool("delete_task", "Borra la tarea de prueba").allowed, false);
  assert.equal(authorizeAgentTool("delete_task", "Sí, bórralo").allowed, true);
  assert.equal(listAgentToolPolicies().delete_task.requiresConfirmation, true);
});

test("Telegram reports its real device boundary", () => {
  const status = renderTelegramCapabilities();
  assert.match(status, /No existe una memoria separada de Telegram/);
  assert.match(status, /Acciones del iPhone/);
  assert.equal(telegramCapabilityMatrix.some((item) => item.state === "iphone"), true);
});
