const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const GOOGLE_PLACES_BASE_URL = "https://places.googleapis.com/v1/places";
const RESTRICTED_RADIUS_METERS = 12_000;
const BIASED_RADIUS_METERS = 24_000;
const ENRICHED_SUGGESTION_COUNT = 5;

function buildPlacesError(status, code, message) {
  const error = new Error(message);
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

async function readErrorMessage(res, fallbackMessage) {
  const body = await res.json().catch(() => null);
  return body?.error?.message || body?.message || fallbackMessage;
}

function buildLocationCircle(lat, lng, radius) {
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

function buildOrigin(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    latitude: lat,
    longitude: lng,
  };
}

function rankPredictions(predictions) {
  return [...predictions].sort((a, b) => {
    const aDistance = Number.isFinite(a.distanceMeters) ? a.distanceMeters : Number.POSITIVE_INFINITY;
    const bDistance = Number.isFinite(b.distanceMeters) ? b.distanceMeters : Number.POSITIVE_INFINITY;
    if (aDistance !== bDistance) return aDistance - bDistance;
    return 0;
  });
}

async function autocompleteRequest(body) {
  const res = await fetch(GOOGLE_PLACES_AUTOCOMPLETE_URL, {
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
  });

  if (!res.ok) {
    throw buildPlacesError(
      res.status,
      "calendar_places_lookup_failed",
      await readErrorMessage(res, "Failed to fetch place suggestions."),
    );
  }

  const data = await res.json();
  return (data?.suggestions || [])
    .map((entry) => entry.placePrediction)
    .filter(Boolean)
    .map((prediction) => ({
      placeId: prediction.placeId,
      primaryText: prediction.structuredFormat?.mainText?.text || prediction.text?.text || "",
      secondaryText: prediction.structuredFormat?.secondaryText?.text || "",
      fullText: prediction.text?.text || "",
      distanceMeters: Number.isFinite(prediction.distanceMeters) ? prediction.distanceMeters : null,
    }))
    .filter((prediction) => prediction.placeId && prediction.primaryText);
}

async function enrichSuggestions(predictions) {
  const enriched = await Promise.all(predictions.map(async (prediction, index) => {
    if (index >= ENRICHED_SUGGESTION_COUNT) return prediction;
    try {
      const details = await getGooglePlaceDetails(prediction.placeId);
      return {
        ...prediction,
        primaryText: details.displayName || prediction.primaryText,
        secondaryText: details.formattedAddress || prediction.secondaryText,
        fullText: details.location || prediction.fullText,
      };
    } catch {
      return prediction;
    }
  }));
  return enriched;
}

export async function suggestGooglePlaces(query, options = {}) {
  requirePlacesConfig();

  const input = String(query || "").trim();
  if (!input) return [];

  const body = {
    input,
    languageCode: "en",
    regionCode: "US",
    includedRegionCodes: ["us"],
  };

  if (options.sessionToken) body.sessionToken = options.sessionToken;
  const origin = buildOrigin(options.lat, options.lng);
  if (origin) body.origin = origin;

  let predictions = [];
  const locationRestriction = buildLocationCircle(options.lat, options.lng, RESTRICTED_RADIUS_METERS);
  if (locationRestriction) {
    predictions = await autocompleteRequest({
      ...body,
      locationRestriction,
    });
  }

  if (predictions.length < ENRICHED_SUGGESTION_COUNT) {
    const locationBias = buildLocationCircle(options.lat, options.lng, BIASED_RADIUS_METERS);
    predictions = await autocompleteRequest({
      ...body,
      ...(locationBias ? { locationBias } : null),
    });
  }

  return enrichSuggestions(rankPredictions(predictions));
}

export async function getGooglePlaceDetails(placeId, options = {}) {
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

  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": "id,displayName,formattedAddress,location,googleMapsUri",
    },
  });

  if (!res.ok) {
    throw buildPlacesError(
      res.status,
      "calendar_place_details_failed",
      await readErrorMessage(res, "Failed to load place details."),
    );
  }

  const data = await res.json();
  const displayName = data?.displayName?.text || "";
  const formattedAddress = data?.formattedAddress || "";
  const location = displayName && formattedAddress
    ? `${displayName}, ${formattedAddress}`
    : displayName || formattedAddress;

  return {
    placeId: data?.id || id,
    displayName,
    formattedAddress,
    location,
    lat: data?.location?.latitude ?? null,
    lng: data?.location?.longitude ?? null,
    googleMapsUri: data?.googleMapsUri || "",
  };
}
