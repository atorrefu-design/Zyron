import assert from "node:assert/strict";
import test from "node:test";
import { webLocationObservation } from "../../lib/channels/location.ts";
import { buildGmailDraftRaw } from "../../lib/google/gmail.ts";
import { formatWeatherReply, weatherCodeLabel, weatherForecastUrl, weatherRequestHorizon } from "../../lib/weather.ts";

test("browser location context is short-lived and rejects stale coordinates", () => {
  const now = new Date("2026-09-08T10:00:00.000Z");
  const current = webLocationObservation({ latitude: 41.3874, longitude: 2.1686, accuracy: 12, capturedAt: now.toISOString() }, now);
  assert.equal(current?.horizontalAccuracy, 12);
  assert.equal(current?.telegramMessageId, 0);
  assert.equal(webLocationObservation({ latitude: 41, longitude: 2, capturedAt: "2026-09-08T09:50:00.000Z" }, now), null);
});

test("ordinary weather questions always route to the deterministic forecast", () => {
  assert.equal(weatherRequestHorizon("¿Qué clima hará mañana?"), "tomorrow");
  assert.equal(weatherRequestHorizon("¿Qué tiempo hace ahora?"), "today");
  assert.equal(weatherRequestHorizon("¿Qué tareas tengo?"), null);
  const reply = formatWeatherReply({
    source: "Open-Meteo",
    current: { time: null, temperatureC: 22, feelsLikeC: 22, condition: "despejado", windKmh: 5, precipitationMm: 0 },
    days: [
      { date: "2026-09-08", condition: "despejado", maxC: 27, minC: 18, precipitationProbability: 5 },
      { date: "2026-09-09", condition: "lluvia", maxC: 23, minC: 17, precipitationProbability: 70 },
    ],
  }, "tomorrow", "Barcelona");
  assert.match(reply, /mañana: lluvia/);
  assert.match(reply, /70 %/);
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
