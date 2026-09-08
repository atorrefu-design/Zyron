import assert from "node:assert/strict";
import test from "node:test";
import { bluetoothContextLabels, normalizeBluetoothContextEvent } from "../../lib/device-context.ts";

test("vehicle Bluetooth defaults to a deterministic briefing", () => {
  assert.deepEqual(normalizeBluetoothContextEvent({ context: "vehicle", deviceName: "SEAT Arona" }), {
    context: "vehicle",
    action: "briefing",
    deviceName: "SEAT Arona",
  });
});

test("other Bluetooth contexts default to context-only and accept safe actions", () => {
  assert.equal(normalizeBluetoothContextEvent({ context: "headphones" })?.action, "record_only");
  assert.equal(normalizeBluetoothContextEvent({ context: "work", action: "daily_plan" })?.action, "daily_plan");
  assert.equal(bluetoothContextLabels.home, "casa");
});

test("Bluetooth context input is bounded and rejects unknown profiles", () => {
  assert.equal(normalizeBluetoothContextEvent({ context: "spaceship", action: "briefing" }), null);
  assert.equal(normalizeBluetoothContextEvent(null), null);
  assert.equal(normalizeBluetoothContextEvent({ context: "home", deviceName: "Casa\naltavoz" })?.deviceName, "Casa altavoz");
});
