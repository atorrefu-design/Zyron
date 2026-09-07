import assert from "node:assert/strict";
import test from "node:test";
import {
  STATIC_TELEGRAM_LOCATION_TTL_MS,
  agentLocationContext,
  isCurrentChannelLocation,
  telegramLocationObservation,
} from "../../lib/channels/location.ts";

const receivedAt = new Date("2026-09-01T10:00:00.000Z");

test("a static Telegram location is retained for 30 minutes only", () => {
  const observation = telegramLocationObservation({
    message_id: 10,
    date: Math.floor(receivedAt.getTime() / 1_000),
    location: { latitude: 41.3874, longitude: 2.1686, horizontal_accuracy: 12 },
  }, receivedAt);
  assert.ok(observation);
  assert.equal(observation.live, false);
  assert.equal(new Date(observation.expiresAt).getTime() - receivedAt.getTime(), STATIC_TELEGRAM_LOCATION_TTL_MS);
});

test("a Telegram live location keeps the expiry selected by the owner", () => {
  const observation = telegramLocationObservation({
    message_id: 11,
    date: Math.floor(receivedAt.getTime() / 1_000),
    edit_date: Math.floor(receivedAt.getTime() / 1_000) + 90,
    location: { latitude: 41.401, longitude: 2.174, live_period: 3_600 },
  }, receivedAt);
  assert.ok(observation);
  assert.equal(observation.live, true);
  assert.equal(observation.observedAt, "2026-09-01T10:01:30.000Z");
  assert.equal(observation.expiresAt, "2026-09-01T11:00:00.000Z");
});

test("invalid and expired locations are never exposed to the agent", () => {
  assert.equal(telegramLocationObservation({
    message_id: 12,
    date: 1,
    location: { latitude: 92, longitude: 2.1 },
  }, receivedAt), null);
  const expired = {
    latitude: 41.3874,
    longitude: 2.1686,
    horizontalAccuracy: null,
    live: true,
    telegramMessageId: 13,
    observedAt: "2026-09-01T09:00:00.000Z",
    expiresAt: "2026-09-01T09:30:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
  };
  assert.equal(isCurrentChannelLocation(expired, receivedAt), false);
});

test("the agent receives current coordinates without exposing them by default", () => {
  const context = agentLocationContext({
    latitude: 41.3874,
    longitude: 2.1686,
    horizontalAccuracy: 8,
    live: true,
    telegramMessageId: 14,
    observedAt: "2026-09-01T10:00:00.000Z",
    expiresAt: "2026-09-01T11:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  });
  assert.match(context, /latitud=41\.387400/);
  assert.match(context, /no las muestres/);
});
