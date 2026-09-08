import { validSharedLocation } from "./maps-links.ts";

const OPEN_METEO_API = "https://api.open-meteo.com/v1/forecast";

export function weatherCodeLabel(code: number) {
  if (code === 0) return "despejado";
  if (code <= 3) return "parcialmente nuboso";
  if (code === 45 || code === 48) return "niebla";
  if (code >= 51 && code <= 57) return "llovizna";
  if (code >= 61 && code <= 67) return "lluvia";
  if (code >= 71 && code <= 77) return "nieve";
  if (code >= 80 && code <= 82) return "chubascos";
  if (code >= 85 && code <= 86) return "chubascos de nieve";
  if (code >= 95) return "tormenta";
  return "condiciones variables";
}

export type WeatherHorizon = "today" | "tomorrow";

export function weatherRequestHorizon(query: string): WeatherHorizon | null {
  const clean = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!/\b(tiempo|clima|lluvia|temperatura|prevision|pronostico)\b/.test(clean)) return null;
  if (/\b(hoy|ahora|actual|hace)\b/.test(clean)) return "today";
  return "tomorrow";
}

export function weatherForecastUrl(latitude: number, longitude: number) {
  if (!validSharedLocation(latitude, longitude)) throw new Error("weather_invalid_location");
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: "Europe/Madrid",
    forecast_days: "3",
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  });
  return `${OPEN_METEO_API}?${params.toString()}`;
}

type ForecastResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    precipitation?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
};

export async function getWeatherForecast(latitude: number, longitude: number) {
  const response = await fetch(weatherForecastUrl(latitude, longitude), {
    headers: { "User-Agent": "ZYRON/0.22" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`weather_api_${response.status}`);
  const payload = await response.json() as ForecastResponse;
  if (!payload.current || !payload.daily?.time?.length) throw new Error("weather_response_invalid");
  const daily = payload.daily;
  const dates = daily.time ?? [];
  return {
    source: "Open-Meteo",
    current: {
      time: payload.current.time ?? null,
      temperatureC: payload.current.temperature_2m ?? null,
      feelsLikeC: payload.current.apparent_temperature ?? null,
      condition: weatherCodeLabel(Number(payload.current.weather_code)),
      windKmh: payload.current.wind_speed_10m ?? null,
      precipitationMm: payload.current.precipitation ?? null,
    },
    days: dates.slice(0, 3).map((date, index) => ({
      date,
      condition: weatherCodeLabel(Number(daily.weather_code?.[index])),
      maxC: daily.temperature_2m_max?.[index] ?? null,
      minC: daily.temperature_2m_min?.[index] ?? null,
      precipitationProbability: daily.precipitation_probability_max?.[index] ?? null,
    })),
  };
}

export function formatWeatherReply(
  forecast: Awaited<ReturnType<typeof getWeatherForecast>>,
  horizon: WeatherHorizon,
  locationLabel: string,
) {
  const day = forecast.days[horizon === "tomorrow" ? 1 : 0];
  if (!day) throw new Error("weather_day_unavailable");
  const period = horizon === "tomorrow" ? "mañana" : "hoy";
  const temperatures = day.minC === null || day.maxC === null
    ? "temperaturas no disponibles"
    : `mínima de ${Math.round(day.minC)} °C y máxima de ${Math.round(day.maxC)} °C`;
  const rain = day.precipitationProbability === null
    ? "sin dato fiable de probabilidad de lluvia"
    : `${Math.round(day.precipitationProbability)} % de probabilidad máxima de lluvia`;
  return `En ${locationLabel}, ${period}: ${day.condition}, ${temperatures} y ${rain}. Fuente: Open-Meteo.`;
}
