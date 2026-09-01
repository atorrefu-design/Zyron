import assert from "node:assert/strict";
import test from "node:test";
import { decideAction } from "../../lib/capabilities/action-policy.ts";
import { buildNativePayload } from "../../lib/capabilities/native-payload.ts";
import { resolveCapabilityRequest } from "../../lib/capabilities/resolve.ts";

test("iPhone calls resolve to the native companion without claiming a completed call", () => {
  const resolution = resolveCapabilityRequest("ZYRON, llama a Sarai");
  const decision = decideAction(resolution, "ZYRON, llama a Sarai");
  assert.deepEqual(decision, {
    kind: "execute",
    capabilityId: "phone.call",
    transport: "native",
    target: "phone.call",
  });
  assert.deepEqual(buildNativePayload("phone.call", "ZYRON, llama a Sarai"), { target: "Sarai" });
});

test("SMS composition preserves recipient and text", () => {
  const resolution = resolveCapabilityRequest("Envía un SMS a mamá diciendo llegaré a las ocho");
  const decision = decideAction(resolution, "Envía un SMS a mamá diciendo llegaré a las ocho");
  assert.equal(decision.kind, "execute");
  assert.deepEqual(buildNativePayload("messages.sms", "Envía un SMS a mamá diciendo llegaré a las ocho"), {
    target: "mamá",
    message: "llegaré a las ocho",
  });
});

test("WhatsApp uses a real native handoff and never a silent send", () => {
  const input = "Escribe a Laura por WhatsApp que llegaré tarde";
  const resolution = resolveCapabilityRequest(input);
  const decision = decideAction(resolution, input);
  assert.deepEqual(decision, {
    kind: "execute",
    capabilityId: "whatsapp.handoff",
    transport: "native",
    target: "open_whatsapp_target",
  });
  assert.deepEqual(buildNativePayload("open_whatsapp_target", input), {
    target: "Laura",
    message: "llegaré tarde",
  });
});
