import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("vehicle Bluetooth automation launches the dedicated voice mode", async () => {
  const shortcuts = await readFile(new URL("ios/ZYRONApp/ZyronShortcuts.swift", root), "utf8");
  const controller = await readFile(new URL("ios/ZYRONApp/ZyronAppController.swift", root), "utf8");

  assert.match(shortcuts, /struct VehicleModeZyronIntent/);
  assert.match(shortcuts, /zyron\.intent\.vehicle-mode/);
  assert.match(shortcuts, /static var openAppWhenRun = true/);
  assert.match(controller, /VehicleModePrompt\.command\(\)/);
});

test("vehicle mode has a direct Google Maps realtime tool and safe web fallback", async () => {
  const realtime = await readFile(new URL("app/api/realtime/native-call/route.ts", root), "utf8");
  const router = await readFile(new URL("ios/ZYRONNative/RealtimeToolRouter.swift", root), "utf8");
  const actions = await readFile(new URL("ios/ZYRONNative/NativeDeviceActions.swift", root), "utf8");

  assert.match(realtime, /name: "iniciar_navegacion_google_maps"/);
  assert.match(router, /navigation\.google_maps\.start/);
  assert.match(actions, /scheme = "comgooglemaps"/);
  assert.match(actions, /https:\/\/www\.google\.com\/maps\/dir\//);
  assert.match(actions, /directionsmode", value: "driving"/);
});
