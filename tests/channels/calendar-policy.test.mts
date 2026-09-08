import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeAgentTool,
  explicitlyConfirmsCalendarAction,
} from "../../lib/agent/policy.ts";
import { classifyAgentToolFailure } from "../../lib/agent/tool-errors.ts";

test("calendar writes require a separate explicit confirmation", () => {
  const initial = authorizeAgentTool("create_calendar_event", "Añade dentista mañana a las cinco");
  assert.equal(initial.allowed, false);
  assert.match(initial.reason, /confirmarlo/);

  assert.equal(authorizeAgentTool("create_calendar_event", "Confirmo").allowed, true);
  assert.equal(authorizeAgentTool("create_calendar_event", "Confirmar creación").allowed, true);
  assert.equal(authorizeAgentTool("create_calendar_events", "Confirmar creación").allowed, true);
  assert.equal(authorizeAgentTool("create_calendar_events", "Sí, créalos").allowed, true);
  assert.equal(authorizeAgentTool("delete_calendar_event", "Sí, elimínalo").allowed, true);
  assert.equal(authorizeAgentTool("delete_calendar_event", "¿Cuál era?").allowed, false);
});

test("calendar creation wording cannot confirm a destructive action", () => {
  assert.equal(authorizeAgentTool("delete_calendar_event", "Confirmar creación").allowed, false);
  assert.equal(authorizeAgentTool("delete_task", "Sí, créalos").allowed, false);
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

test("calendar permission errors request a manual Google reconnect", () => {
  const failure = classifyAgentToolFailure(
    "create_calendar_event",
    new Error("google_calendar_create_403:Request had insufficient authentication scopes"),
  );
  assert.equal(failure.code, "calendar_write_scope_missing");
  assert.match(failure.summary, /Reconecta Google/);
});

test("generic failures never promise an automatic retry", () => {
  const failure = classifyAgentToolFailure("create_calendar_event", new Error("network_timeout"));
  assert.equal(failure.code, "tool_temporarily_unavailable");
  assert.match(failure.summary, /No se ha programado ningún reintento automático/);
});
