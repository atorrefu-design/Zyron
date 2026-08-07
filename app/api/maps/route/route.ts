import { NextResponse } from "next/server";
import {
  computeDrivingRoute,
  mapsConfigured,
  planDepartureForArrival,
} from "../../../../lib/google/routes";

export const runtime = "nodejs";

type RouteRequest = {
  origin?: { latitude?: number; longitude?: number };
  destination?: string;
  arrivalTime?: string | null;
  bufferMinutes?: number;
};

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export async function GET() {
  return NextResponse.json(
    { configured: mapsConfigured(), provider: "google_routes" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!mapsConfigured()) {
    return NextResponse.json(
      { error: "maps_not_configured", configured: false },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as RouteRequest;
    const latitude = body.origin?.latitude;
    const longitude = body.origin?.longitude;
    const destination = body.destination?.trim();

    if (!validCoordinate(latitude, -90, 90) || !validCoordinate(longitude, -180, 180)) {
      return NextResponse.json({ error: "origin_invalid" }, { status: 400 });
    }
    if (!destination || destination.length > 300) {
      return NextResponse.json({ error: "destination_invalid" }, { status: 400 });
    }

    const origin = { latitude, longitude };
    const destinationPoint = { address: destination };

    if (body.arrivalTime) {
      const arrivalTime = new Date(body.arrivalTime);
      if (!Number.isFinite(arrivalTime.getTime())) {
        return NextResponse.json({ error: "arrival_time_invalid" }, { status: 400 });
      }
      const result = await planDepartureForArrival({
        origin,
        destination: destinationPoint,
        arrivalTime,
        bufferMinutes: body.bufferMinutes,
      });
      return NextResponse.json({ configured: true, mode: "arrive_by", route: result });
    }

    const result = await computeDrivingRoute({ origin, destination: destinationPoint });
    return NextResponse.json({ configured: true, mode: "leave_now", route: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "maps_route_error";
    console.error("ZYRON_MAPS_ROUTE_ERROR", error);
    const status = /maps_routes_4\d\d/.test(message) ? 502 : 500;
    return NextResponse.json({ error: message.slice(0, 300) }, { status });
  }
}
