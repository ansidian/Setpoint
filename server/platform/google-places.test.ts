import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGooglePlaceDetails, suggestGooglePlaces } from "./google-places.ts";

const credentials = (value: string | null) => ({
  resolve: vi.fn(async () => ({
    key: "calendar.google_places_api_key" as const,
    source: value ? "stored" as const : "absent" as const,
    value,
  })),
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("google-places fetch deadlines", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the autocomplete request with an AbortSignal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({
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
      }));

    await suggestGooglePlaces("123 Main", { lat: 1.1, lng: 2.2 }, credentials("test-places-key") as never);

    // test-architecture: allow-boundary-interaction -- Google Places fetch is an outbound provider boundary; credential rotation, headers, and timeout signals are the provider compatibility contract.
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the details request with an AbortSignal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
        id: "place-1",
        displayName: { text: "Somewhere" },
        formattedAddress: "123 Main St",
        location: { latitude: 1.1, longitude: 2.2 },
        googleMapsUri: "https://maps.google.com/?q=place-1",
      }));

    await getGooglePlaceDetails("place-1", {}, credentials("test-places-key") as never);

    // test-architecture: allow-boundary-interaction -- Google Places fetch is an outbound provider boundary; credential rotation, headers, and timeout signals are the provider compatibility contract.
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("resolves a rotated key for each request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ suggestions: [] }));

    await suggestGooglePlaces("coffee", {}, credentials("first-key") as never);
    await suggestGooglePlaces("coffee", {}, credentials("rotated-key") as never);

    // test-architecture: allow-boundary-interaction -- Google Places fetch is an outbound provider boundary; credential rotation, headers, and timeout signals are the provider compatibility contract.
    expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({ "X-Goog-Api-Key": "first-key" });
    // test-architecture: allow-boundary-interaction -- Google Places fetch is an outbound provider boundary; credential rotation, headers, and timeout signals are the provider compatibility contract.
    expect(fetchMock.mock.calls[1]![1]?.headers).toMatchObject({ "X-Goog-Api-Key": "rotated-key" });
  });

  it("degrades only Places when no key is configured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(suggestGooglePlaces("coffee", {}, credentials(null) as never)).rejects.toMatchObject({
      status: 503,
      code: "calendar_places_not_configured",
    });
    // test-architecture: allow-boundary-interaction -- Global fetch is the outbound Google Places boundary; the safety contract is that missing credentials produce no network request.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
