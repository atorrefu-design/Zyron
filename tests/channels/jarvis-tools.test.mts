import assert from "node:assert/strict";
import test from "node:test";
import { webLocationObservation } from "../../lib/channels/location.ts";
import { buildGmailDraftRaw } from "../../lib/google/gmail.ts";
import { weatherCodeLabel, weatherForecastUrl } from "../../lib/weather.ts";

test("browser location context is short-lived and rejects stale coordinates", () => {
  const now = new Date("2026-09-08T10:00:00.000Z");
  const current = webLocationObservation({ latitude: 41.3874, longitude: 2.1686, accuracy: 12, capturedAt: now.toISOString() }, now);
  assert.equal(current?.horizontalAccuracy, 12);
  assert.equal(current?.telegramMessageId, 0);
  assert.equal(webLocationObservation({ latitude: 41, longitude: 2, capturedAt: "2026-09-08T09:50:00.000Z" }, now), null);
});

test("weather adapter requests current conditions and a three-day forecast", () => {
  const url = new URL(weatherForecastUrl(41.3874, 2.1686));
  assert.equal(url.hostname, "api.open-meteo.com");
  assert.equal(url.searchParams.get("forecast_days"), "3");
  assert.match(url.searchParams.get("current") || "", /temperature_2m/);
  assert.equal(weatherCodeLabel(95), "tormenta");
  assert.throws(() => weatherForecastUrl(100, 2), /weather_invalid_location/);
});

test("Gmail draft encoding prevents header injection and remains draft-only", () => {
  assert.throws(() => buildGmailDraftRaw({ to: "ana@example.com\r\nBcc: evil@example.com", subject: "Prueba", body: "Hola" }), /gmail_invalid_recipient/);
  const raw = buildGmailDraftRaw({ to: "ana@example.com", subject: "Reunión\r\nBcc: no", body: "Hola Ana" });
  assert.doesNotMatch(raw, /\r\nBcc:/);
  assert.match(raw, /^To: ana@example\.com/m);
  assert.match(raw, /Content-Type: text\/plain/);
  assert.match(raw, /Hola Ana$/);
});
