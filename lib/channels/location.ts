import { validSharedLocation } from "../maps-links.ts";

export const STATIC_TELEGRAM_LOCATION_TTL_MS = 30 * 60 * 1_000;
const TELEGRAM_INDEFINITE_LIVE_PERIOD = 0x7fffffff;

export type TelegramLocationMessage = {
  message_id: number;
  date: number;
  edit_date?: number;
  location: {
    latitude: number;
    longitude: number;
    horizontal_accuracy?: number;
    live_period?: number;
  };
};

export type ChannelLocationObservation = {
  latitude: number;
  longitude: number;
  horizontalAccuracy: number | null;
  live: boolean;
  telegramMessageId: number;
  observedAt: string;
  expiresAt: string;
};

export type CurrentChannelLocation = ChannelLocationObservation & {
  updatedAt: string;
};

function safeDate(milliseconds: number) {
  return new Date(Math.min(milliseconds, 8_640_000_000_000_000));
}

export function telegramLocationObservation(
  message: TelegramLocationMessage,
  receivedAt = new Date(),
): ChannelLocationObservation | null {
  const { location } = message;
  if (!validSharedLocation(location.latitude, location.longitude)) return null;

  const livePeriod = Number(location.live_period || 0);
  const live = Number.isInteger(livePeriod) && livePeriod > 0;
  const sourceSeconds = Number(message.edit_date || message.date);
  const observedAt = Number.isFinite(sourceSeconds) && sourceSeconds > 0
    ? new Date(sourceSeconds * 1_000)
    : receivedAt;
  const expiresAt = live
    ? safeDate(
      livePeriod === TELEGRAM_INDEFINITE_LIVE_PERIOD
        ? observedAt.getTime() + livePeriod * 1_000
        : Number(message.date) * 1_000 + livePeriod * 1_000,
    )
    : new Date(receivedAt.getTime() + STATIC_TELEGRAM_LOCATION_TTL_MS);
  const accuracy = Number(location.horizontal_accuracy);

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    horizontalAccuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    live,
    telegramMessageId: message.message_id,
    observedAt: observedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function isCurrentChannelLocation(location: CurrentChannelLocation | null, now = new Date()) {
  return Boolean(location && new Date(location.expiresAt).getTime() > now.getTime());
}

export function agentLocationContext(location: CurrentChannelLocation | null) {
  if (!location) return "No hay una ubicación actual autorizada en este canal.";
  const accuracy = location.horizontalAccuracy === null
    ? "exactitud no indicada"
    : `exactitud aproximada ${Math.round(location.horizontalAccuracy)} m`;
  return [
    `Ubicación actual autorizada: latitud=${location.latitude.toFixed(6)}, longitud=${location.longitude.toFixed(6)} (${accuracy}).`,
    `Última actualización: ${location.observedAt}. Válida hasta: ${location.expiresAt}.`,
    "Úsala como origen cuando Aarón diga «aquí», «cerca de mí», «donde estoy» o equivalente. Pasa estas coordenadas a las herramientas de lugares y rutas, pero no las muestres en la respuesta salvo que él las pida.",
  ].join(" ");
}
