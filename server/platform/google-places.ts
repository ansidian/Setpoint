import { fetchWithTimeout } from "./fetch-with-timeout.ts";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const GOOGLE_PLACES_BASE_URL = "https://places.googleapis.com/v1/places";
const GOOGLE_PLACES_TIMEOUT_MS = 10_000;
const RESTRICTED_RADIUS_METERS = 12_000;
const BIASED_RADIUS_METERS = 24_000;
// Target number of suggestions before widening the search radius from
// locationRestriction to locationBias (see suggestGooglePlaces).
const MIN_SUGGESTION_COUNT = 5;

type PlacesError = Error & { status: number; code: string };
type Coordinates = { latitude: number; longitude: number };
type PlaceSearchOptions = { sessionToken?: string; lat?: number; lng?: number };
type PlacePrediction = {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
  distanceMeters: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function nestedText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return isRecord(value) ? stringField(value, "text") : "";
}

function buildPlacesError(status: number, code: string, message: string): PlacesError {
  const error = new Error(message) as PlacesError;
  error.status = status;
  error.code = code;
  return error;
}

function requirePlacesConfig() {
  if (!GOOGLE_PLACES_API_KEY) {
    throw buildPlacesError(
      503,
      "calendar_places_not_configured",
      "Google Places is not configured for calendar location search.",
    );
  }
}

async function readErrorMessage(res: Response, fallbackMessage: string) {
  const body: unknown = await res.json().catch(() => null);
  if (!isRecord(body)) return fallbackMessage;
  const nestedError = body.error;
  if (isRecord(nestedError) && typeof nestedError.message === "string") return nestedError.message;
  return typeof body.message === "string" ? body.message : fallbackMessage;
}

function buildLocationCircle(lat: number | undefined, lng: number | undefined, radius: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    circle: {
      center: {
        latitude: lat,
        longitude: lng,
      },
      radius,
    },
  };
}

function buildOrigin(lat: number | undefined, lng: number | undefined): Coordinates | null {
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    latitude: lat,
    longitude: lng,
  };
}

function rankPredictions(predictions: readonly PlacePrediction[]) {
  return [...predictions].sort((a, b) => {
    const aDistance = typeof a.distanceMeters === "number" && Number.isFinite(a.distanceMeters)
      ? a.distanceMeters
      : Number.POSITIVE_INFINITY;
    const bDistance = typeof b.distanceMeters === "number" && Number.isFinite(b.distanceMeters)
      ? b.distanceMeters
      : Number.POSITIVE_INFINITY;
    if (aDistance !== bDistance) return aDistance - bDistance;
    return 0;
  });
}

function normalizePrediction(entry: unknown): PlacePrediction | null {
  if (!isRecord(entry) || !isRecord(entry.placePrediction)) return null;
  const prediction = entry.placePrediction;
  const text = isRecord(prediction.text) ? nestedText(prediction, "text") : "";
  const structured = isRecord(prediction.structuredFormat) ? prediction.structuredFormat : {};
  const primaryText = isRecord(structured.mainText)
    ? nestedText(structured, "mainText") || text
    : text;
  const secondaryText = isRecord(structured.secondaryText)
    ? nestedText(structured, "secondaryText")
    : "";
  const placeId = stringField(prediction, "placeId");
  if (!placeId || !primaryText) return null;
  return {
    placeId,
    primaryText,
    secondaryText,
    fullText: text,
    distanceMeters: typeof prediction.distanceMeters === "number" && Number.isFinite(prediction.distanceMeters)
      ? prediction.distanceMeters
      : null,
  };
}

async function autocompleteRequest(body: Record<string, unknown>): Promise<PlacePrediction[]> {
  const res = await fetchWithTimeout(GOOGLE_PLACES_AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": [
        "suggestions.placePrediction.placeId",
        "suggestions.placePrediction.text",
        "suggestions.placePrediction.structuredFormat",
        "suggestions.placePrediction.distanceMeters",
      ].join(","),
    },
    body: JSON.stringify(body),
  }, { timeoutMs: GOOGLE_PLACES_TIMEOUT_MS });

  if (!res.ok) {
    throw buildPlacesError(
      res.status,
      "calendar_places_lookup_failed",
      await readErrorMessage(res, "Failed to fetch place suggestions."),
    );
  }

  const data: unknown = await res.json();
  const suggestions = isRecord(data) && Array.isArray(data.suggestions) ? data.suggestions : [];
  return suggestions
    .map(normalizePrediction)
    .filter((prediction): prediction is PlacePrediction => prediction !== null);
}

export async function suggestGooglePlaces(query: unknown, options: PlaceSearchOptions = {}) {
  requirePlacesConfig();

  const input = String(query || "").trim();
  if (!input) return [];

  const body: Record<string, unknown> = {
    input,
    languageCode: "en",
    regionCode: "US",
    includedRegionCodes: ["us"],
  };

  if (options.sessionToken) body.sessionToken = options.sessionToken;
  const origin = buildOrigin(options.lat, options.lng);
  if (origin) body.origin = origin;

  let predictions: PlacePrediction[] = [];
  const locationRestriction = buildLocationCircle(options.lat, options.lng, RESTRICTED_RADIUS_METERS);
  if (locationRestriction) {
    predictions = await autocompleteRequest({
      ...body,
      locationRestriction,
    });
  }

  if (predictions.length < MIN_SUGGESTION_COUNT) {
    const locationBias = buildLocationCircle(options.lat, options.lng, BIASED_RADIUS_METERS);
    predictions = await autocompleteRequest({
      ...body,
      ...(locationBias ? { locationBias } : null),
    });
  }

  // P2-26: return autocomplete predictions directly. The dropdown renders from
  // primaryText/secondaryText, and the full place is loaded once on selection via
  // getGooglePlaceDetails — the previous per-keystroke Details pre-enrichment of
  // the top suggestions was redundant billed work.
  return rankPredictions(predictions);
}

export async function getGooglePlaceDetails(placeId: unknown, options: PlaceSearchOptions = {}) {
  requirePlacesConfig();

  const id = String(placeId || "").trim();
  if (!id) {
    throw buildPlacesError(400, "calendar_place_id_required", "A placeId is required.");
  }

  const url = new URL(`${GOOGLE_PLACES_BASE_URL}/${encodeURIComponent(id)}`);
  url.searchParams.set("languageCode", "en");
  url.searchParams.set("regionCode", "US");
  if (options.sessionToken) {
    url.searchParams.set("sessionToken", options.sessionToken);
  }

  const res = await fetchWithTimeout(url, {
    headers: {
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": "id,displayName,formattedAddress,location,googleMapsUri",
    },
  }, { timeoutMs: GOOGLE_PLACES_TIMEOUT_MS });

  if (!res.ok) {
    throw buildPlacesError(
      res.status,
      "calendar_place_details_failed",
      await readErrorMessage(res, "Failed to load place details."),
    );
  }

  const data: unknown = await res.json();
  const record = isRecord(data) ? data : {};
  const displayName = isRecord(record.displayName) ? nestedText(record, "displayName") : "";
  const formattedAddress = stringField(record, "formattedAddress");
  const rawLocation = isRecord(record.location) ? record.location : {};
  const location = displayName && formattedAddress
    ? `${displayName}, ${formattedAddress}`
    : displayName || formattedAddress;

  return {
    placeId: stringField(record, "id") || id,
    displayName,
    formattedAddress,
    location,
    lat: typeof rawLocation.latitude === "number" ? rawLocation.latitude : null,
    lng: typeof rawLocation.longitude === "number" ? rawLocation.longitude : null,
    googleMapsUri: stringField(record, "googleMapsUri"),
  };
}
