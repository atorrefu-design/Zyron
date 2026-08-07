const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

export type RoutePoint =
  | { latitude: number; longitude: number }
  | { address: string };

export type DrivingRouteEstimate = {
  durationSeconds: number;
  staticDurationSeconds: number | null;
  distanceMeters: number;
  departureTime: string;
  arrivalTime: string;
  trafficDelaySeconds: number | null;
};

type GoogleRoute = {
  duration?: string;
  staticDuration?: string;
  distanceMeters?: number;
};

type GoogleRoutesResponse = { routes?: GoogleRoute[] };

function mapsApiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("maps_api_key_missing");
  return key;
}

function seconds(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  return match ? Math.round(Number(match[1])) : null;
}

function waypoint(point: RoutePoint) {
  if ("address" in point) {
    const address = point.address.trim();
    if (!address) throw new Error("maps_address_required");
    return { address };
  }
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    throw new Error("maps_coordinates_invalid");
  }
  return {
    location: {
      latLng: {
        latitude: point.latitude,
        longitude: point.longitude,
      },
    },
  };
}

export function mapsConfigured() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

export async function computeDrivingRoute(options: {
  origin: RoutePoint;
  destination: RoutePoint;
  departureTime?: Date;
}): Promise<DrivingRouteEstimate> {
  const now = new Date();
  const futureDeparture = options.departureTime && options.departureTime.getTime() > now.getTime() + 60_000
    ? options.departureTime
    : null;
  const effectiveDeparture = futureDeparture ?? now;

  const requestBody: Record<string, unknown> = {
    origin: waypoint(options.origin),
    destination: waypoint(options.destination),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    trafficModel: "BEST_GUESS",
    languageCode: "es-ES",
    units: "METRIC",
  };

  // Si queremos salir ahora, Google recomienda omitir departureTime: la API usa
  // automáticamente la hora real de recepción. Enviar new Date() puede llegar unos
  // milisegundos tarde y Google lo rechaza como una hora en el pasado.
  if (futureDeparture) requestBody.departureTime = futureDeparture.toISOString();

  const response = await fetch(ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": mapsApiKey(),
      "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
    },
    body: JSON.stringify(requestBody),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`maps_routes_${response.status}${detail ? `:${detail.slice(0, 220)}` : ""}`);
  }

  const data = (await response.json()) as GoogleRoutesResponse;
  const route = data.routes?.[0];
  const durationSeconds = seconds(route?.duration);
  if (!route || durationSeconds === null) throw new Error("maps_route_unavailable");
  const staticDurationSeconds = seconds(route.staticDuration);
  const departureTime = effectiveDeparture.toISOString();
  const arrivalTime = new Date(effectiveDeparture.getTime() + durationSeconds * 1000).toISOString();
  const trafficDelaySeconds = staticDurationSeconds === null
    ? null
    : Math.max(0, durationSeconds - staticDurationSeconds);

  return {
    durationSeconds,
    staticDurationSeconds,
    distanceMeters: Math.max(0, Number(route.distanceMeters ?? 0)),
    departureTime,
    arrivalTime,
    trafficDelaySeconds,
  };
}

export async function planDepartureForArrival(options: {
  origin: RoutePoint;
  destination: RoutePoint;
  arrivalTime: Date;
  bufferMinutes?: number;
}) {
  const bufferMinutes = Math.max(0, Math.min(60, options.bufferMinutes ?? 10));
  const target = new Date(options.arrivalTime.getTime() - bufferMinutes * 60_000);
  if (!Number.isFinite(target.getTime())) throw new Error("maps_arrival_invalid");

  // Primera estimación con tráfico actual y dos refinamientos usando tráfico previsto
  // para la hora de salida calculada.
  let estimate = await computeDrivingRoute({ origin: options.origin, destination: options.destination });
  let departure = new Date(target.getTime() - estimate.durationSeconds * 1000);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    estimate = await computeDrivingRoute({
      origin: options.origin,
      destination: options.destination,
      departureTime: departure,
    });
    departure = new Date(target.getTime() - estimate.durationSeconds * 1000);
  }

  const leaveInSeconds = Math.round((departure.getTime() - Date.now()) / 1000);
  return {
    ...estimate,
    recommendedDepartureTime: departure.toISOString(),
    targetArrivalTime: options.arrivalTime.toISOString(),
    bufferMinutes,
    leaveInSeconds,
  };
}
