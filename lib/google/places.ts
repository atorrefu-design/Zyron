const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

export type PlaceSearchResult = {
  id: string;
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number | null;
  openNow: boolean | null;
  googleMapsUri: string | null;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  currentOpeningHours?: { openNow?: boolean };
};

type GooglePlacesResponse = {
  places?: GooglePlace[];
};

function mapsApiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new Error("maps_api_key_missing");
  return key;
}

function googleErrorMessage(detail: string) {
  try {
    const parsed = JSON.parse(detail) as { error?: { status?: string; message?: string } };
    return [parsed.error?.status, parsed.error?.message]
      .filter(Boolean)
      .join(": ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
  } catch {
    return detail.replace(/\s+/g, " ").trim().slice(0, 240);
  }
}

export async function searchPlacesText(options: {
  query: string;
  latitude?: number;
  longitude?: number;
  pageSize?: number;
}): Promise<PlaceSearchResult[]> {
  const query = options.query.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!query) throw new Error("places_query_required");

  const pageSize = Math.max(1, Math.min(8, Math.round(options.pageSize ?? 5)));
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "es",
    regionCode: "ES",
    pageSize,
  };

  if (Number.isFinite(options.latitude) && Number.isFinite(options.longitude)) {
    body.locationBias = {
      circle: {
        center: {
          latitude: options.latitude,
          longitude: options.longitude,
        },
        radius: 20_000,
      },
    };
  }

  const response = await fetch(PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": mapsApiKey(),
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.rating",
        "places.userRatingCount",
        "places.googleMapsUri",
        "places.currentOpeningHours.openNow",
      ].join(","),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const diagnostic = googleErrorMessage(detail);
    throw new Error(`maps_places_${response.status}${diagnostic ? `:${diagnostic}` : ""}`);
  }

  const data = (await response.json()) as GooglePlacesResponse;
  return (data.places ?? []).slice(0, pageSize).map((place) => ({
    id: place.id?.trim() || "",
    name: place.displayName?.text?.trim() || "Lugar sin nombre",
    address: place.formattedAddress?.trim() || "Dirección no disponible",
    rating: Number.isFinite(place.rating) ? Number(place.rating) : null,
    reviewCount: Number.isFinite(place.userRatingCount) ? Number(place.userRatingCount) : null,
    openNow: typeof place.currentOpeningHours?.openNow === "boolean" ? place.currentOpeningHours.openNow : null,
    googleMapsUri: place.googleMapsUri?.trim() || null,
  }));
}
