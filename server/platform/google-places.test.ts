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

  it("preserves nearby matches when widening a sparse local search", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        suggestions: [{
          placePrediction: {
            placeId: "c-and-c-alhambra",
            text: { text: "C&C Collision, 518 S Palm Ave, Alhambra, CA 91803" },
            structuredFormat: {
              mainText: { text: "C&C Collision" },
              secondaryText: { text: "518 S Palm Ave, Alhambra, CA 91803" },
            },
            distanceMeters: 8_000,
          },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({ suggestions: [] }));

    const predictions = await suggestGooglePlaces(
      "c&c collision",
      { lat: 34.0686, lng: -118.0276 },
      credentials("test-places-key") as never,
    );

    expect(predictions).toEqual([
      expect.objectContaining({
        placeId: "c-and-c-alhambra",
        secondaryText: "518 S Palm Ave, Alhambra, CA 91803",
      }),
    ]);
    // test-architecture: allow-boundary-interaction -- Google Places request shape is the outbound provider contract that keeps sparse local matches from being replaced by global soft-biased results.
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    // test-architecture: allow-boundary-interaction -- The expanded Google Places request must remain a hard geographic restriction and omit locationBias; a soft bias can return out-of-state matches.
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body));
    expect(firstBody.locationRestriction.circle.radius).toBe(12_000);
    expect(secondBody.locationRestriction.circle.radius).toBe(24_000);
    expect(secondBody).not.toHaveProperty("locationBias");
  });

  it("normalizes an ampersand joined to words before autocomplete", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.input !== "c & c collision") return jsonResponse({ suggestions: [] });
      return jsonResponse({
        suggestions: [{
          placePrediction: {
            placeId: "c-and-c-alhambra",
            text: { text: "C & C Collision, 518 S Palm Ave, Alhambra, CA 91803" },
            structuredFormat: {
              mainText: { text: "C & C Collision" },
              secondaryText: { text: "518 S Palm Ave, Alhambra, CA 91803" },
            },
            distanceMeters: 13_700,
          },
        }],
      });
    });

    const predictions = await suggestGooglePlaces(
      "c&c collision",
      { lat: 34.0686, lng: -118.0276 },
      credentials("test-places-key") as never,
    );

    expect(predictions).toEqual([
      expect.objectContaining({
        placeId: "c-and-c-alhambra",
        primaryText: "C & C Collision",
      }),
    ]);
    // test-architecture: allow-boundary-interaction -- Google Places tokenization is an outbound provider contract; joined ampersands must be normalized before the request so exact local businesses remain discoverable.
    const requestBodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(requestBodies.every((body) => body.input === "c & c collision")).toBe(true);
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
