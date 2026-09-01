import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeAgentTool,
  explicitlyConfirmsCalendarAction,
} from "../../lib/agent/policy.ts";

test("calendar writes require a separate explicit confirmation", () => {
  const initial = authorizeAgentTool("create_calendar_event", "Añade dentista mañana a las cinco");
  assert.equal(initial.allowed, false);
  assert.match(initial.reason, /confirmarlo/);

  assert.equal(authorizeAgentTool("create_calendar_event", "Confirmo").allowed, true);
  assert.equal(authorizeAgentTool("delete_calendar_event", "Sí, elimínalo").allowed, true);
  assert.equal(authorizeAgentTool("delete_calendar_event", "¿Cuál era?").allowed, false);
});

test("confirmation phrases are narrow and accent insensitive", () => {
  assert.equal(explicitlyConfirmsCalendarAction("Créalo"), true);
  assert.equal(explicitlyConfirmsCalendarAction("Sí, cancela el evento"), true);
  assert.equal(explicitlyConfirmsCalendarAction("adelante"), true);
  assert.equal(explicitlyConfirmsCalendarAction("quiero crear un evento"), false);
  assert.equal(explicitlyConfirmsCalendarAction("no lo hagas"), false);
});

test("unknown tools remain blocked", () => {
  assert.equal(authorizeAgentTool("send_email", "adelante").allowed, false);
});
