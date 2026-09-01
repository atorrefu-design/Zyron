import type { RoutePoint } from "./google/routes";

function routePointValue(point: RoutePoint) {
  return "address" in point
    ? point.address.trim()
    : `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
}

export function buildNavigationLinks(origin: RoutePoint, destination: string) {
  const cleanDestination = destination.replace(/\s+/g, " ").trim();
  if (!cleanDestination) throw new Error("maps_destination_required");
  const cleanOrigin = routePointValue(origin);

  const google = new URL("https://www.google.com/maps/dir/");
  google.searchParams.set("api", "1");
  google.searchParams.set("origin", cleanOrigin);
  google.searchParams.set("destination", cleanDestination);
  google.searchParams.set("travelmode", "driving");

  const waze = new URL("https://www.waze.com/ul");
  waze.searchParams.set("q", cleanDestination);
  waze.searchParams.set("navigate", "yes");

  const apple = new URL("https://maps.apple.com/");
  apple.searchParams.set("saddr", cleanOrigin);
  apple.searchParams.set("daddr", cleanDestination);
  apple.searchParams.set("dirflg", "d");

  return { googleMaps: google.toString(), waze: waze.toString(), appleMaps: apple.toString() };
}

export function validSharedLocation(latitude: unknown, longitude: unknown) {
  return typeof latitude === "number"
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && typeof longitude === "number"
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180;
}
