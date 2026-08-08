import { searchPlacesText } from "@/lib/google/places";

export const runtime = "nodejs";

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      query?: string;
      latitude?: number;
      longitude?: number;
    };

    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return Response.json({ error: "places_query_required" }, { status: 400 });

    const places = await searchPlacesText({
      query,
      latitude: finiteNumber(body.latitude),
      longitude: finiteNumber(body.longitude),
      pageSize: 5,
    });

    return Response.json(
      { places },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "places_search_failed";
    console.error("ZYRON_PLACES_ERROR", detail);

    if (detail.startsWith("maps_places_403")) {
      return Response.json(
        {
          error: "places_api_forbidden",
          detail: "Google Places API (New) no está habilitada o la clave no tiene permiso.",
        },
        { status: 503 },
      );
    }

    return Response.json(
      { error: "places_search_failed", detail: detail.slice(0, 260) },
      { status: 500 },
    );
  }
}
