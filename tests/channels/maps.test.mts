import assert from "node:assert/strict";
import test from "node:test";
import { buildNavigationLinks, validSharedLocation } from "../../lib/maps-links.ts";
import { authorizeAgentTool } from "../../lib/agent/policy.ts";
import { classifyAgentToolFailure } from "../../lib/agent/tool-errors.ts";

test("shared Telegram locations require valid coordinates", () => {
  assert.equal(validSharedLocation(41.3874, 2.1686), true);
  assert.equal(validSharedLocation(91, 2.1686), false);
  assert.equal(validSharedLocation(41.3874, null), false);
  assert.equal(validSharedLocation(Number.NaN, 2.1686), false);
});

test("navigation links preserve origin and destination safely", () => {
  const links = buildNavigationLinks(
    { latitude: 41.3874, longitude: 2.1686 },
    "Fundació Brafa, Barcelona",
  );
  assert.match(links.googleMaps, /^https:\/\/www\.google\.com\/maps\/dir\//);
  assert.match(links.googleMaps, /travelmode=driving/);
  assert.match(links.waze, /^https:\/\/www\.waze\.com\/ul/);
  assert.match(links.appleMaps, /^https:\/\/maps\.apple\.com\//);
});

test("maps tools are read-only and do not require confirmation", () => {
  assert.equal(authorizeAgentTool("search_places", "Busca una gasolinera cerca").allowed, true);
  assert.equal(authorizeAgentTool("get_driving_route", "Cuánto tardo a Brafa").allowed, true);
});

test("maps configuration errors are explained precisely", () => {
  const failure = classifyAgentToolFailure("get_driving_route", new Error("maps_routes_403:PERMISSION_DENIED"));
  assert.equal(failure.code, "maps_configuration_required");
});
