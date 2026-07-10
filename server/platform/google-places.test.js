import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// suggestGooglePlaces/getGooglePlaceDetails capture GOOGLE_PLACES_API_KEY at
// module load, so set it before import.
vi.hoisted(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-places-key";
});

import { getGooglePlaceDetails, suggestGooglePlaces } from "./google-places.js";

describe("google-places fetch deadlines", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the autocomplete request with an AbortSignal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            placePrediction: {
              placeId: "place-1",
              text: { text: "123 Main St" },
              structuredFormat: { mainText: { text: "123 Main St" }, secondaryText: { text: "" } },
              distanceMeters: 10,
            },
          },
        ],
      }),
    });

    await suggestGooglePlaces("123 Main", { lat: 1.1, lng: 2.2 });

    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the details request with an AbortSignal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "place-1",
        displayName: { text: "Somewhere" },
        formattedAddress: "123 Main St",
        location: { latitude: 1.1, longitude: 2.2 },
        googleMapsUri: "https://maps.google.com/?q=place-1",
      }),
    });

    await getGooglePlaceDetails("place-1");

    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
