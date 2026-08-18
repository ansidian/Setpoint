import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeGoogleRoute,
  GOOGLE_ROUTES_FIELD_MASK,
} from "./google-routes.ts";

const credentials = (value: string | null) => ({
  resolve: vi.fn(async () => ({
    key: "calendar.google_places_api_key" as const,
    source: value ? "stored" as const : "absent" as const,
    value,
  })),
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Google Routes adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests only traffic-aware driving duration and distance", async () => {
    const requests: Array<[string | URL | Request, RequestInit | undefined]> = [];
    const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push([input, init]);
      return response({ routes: [{ duration: "901.25s", distanceMeters: 12_345 }] });
    };

    await expect(computeGoogleRoute({
      origin: { lat: 47.61, lng: -122.33 },
      destination: "500 Pine St, Seattle, WA",
    }, {
      credentials: credentials("maps-key"),
      fetchFn,
    })).resolves.toEqual({ durationSeconds: 902, distanceMeters: 12_345 });

    expect(requests).toHaveLength(1);
    const [url, init] = requests[0]!;
    expect(String(url)).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": "maps-key",
      "X-Goog-FieldMask": GOOGLE_ROUTES_FIELD_MASK,
    });
    expect(GOOGLE_ROUTES_FIELD_MASK).toBe("routes.duration,routes.distanceMeters");
    expect(JSON.parse(String(init?.body))).toEqual({
      origin: { location: { latLng: { latitude: 47.61, longitude: -122.33 } } },
      destination: { address: "500 Pine St, Seattle, WA" },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    });
    expect(JSON.stringify(init)).not.toMatch(/polyline|toll|highway|ferr/i);
  });

  it("does not call the provider when the Maps key is missing", async () => {
    let providerCalled = false;
    const fetchFn = async () => {
      providerCalled = true;
      return response({ routes: [] });
    };
    await expect(computeGoogleRoute({
      origin: { lat: 1, lng: 2 },
      destination: "123 Main St",
    }, { credentials: credentials(null), fetchFn })).rejects.toMatchObject({
      code: "maps_not_configured",
      status: 409,
    });
    expect(providerCalled).toBe(false);
  });

  it.each([
    [403, { error: { details: [{ reason: "SERVICE_DISABLED" }] } }, "routes_not_enabled"],
    [403, { error: { details: [{ reason: "API_KEY_INVALID" }] } }, "credential_rejected"],
    [400, { error: { status: "INVALID_ARGUMENT" } }, "destination_invalid"],
    [429, { error: { status: "RESOURCE_EXHAUSTED" } }, "rate_limited"],
    [503, { error: { status: "UNAVAILABLE" } }, "provider_unavailable"],
  ])("classifies HTTP %s without reflecting the provider body", async (status, body, code) => {
    const fetchFn = async () => response(body, status);
    const promise = computeGoogleRoute({
      origin: { lat: 1, lng: 2 },
      destination: "123 Main St",
    }, { credentials: credentials("maps-key"), fetchFn });

    await expect(promise).rejects.toMatchObject({ code });
    await expect(promise).rejects.not.toThrow(JSON.stringify(body));
  });

  it.each([
    [{ routes: [] }, "no_route"],
    [{}, "malformed_response"],
    [{ routes: [{ duration: "soon", distanceMeters: 10 }] }, "malformed_response"],
    [{ routes: [{ duration: "10s" }] }, "malformed_response"],
  ])("rejects an unusable successful response as %s", async (body, code) => {
    await expect(computeGoogleRoute({
      origin: { lat: 1, lng: 2 },
      destination: "123 Main St",
    }, {
      credentials: credentials("maps-key"),
      fetchFn: async () => response(body),
    })).rejects.toMatchObject({ code });
  });

  it("classifies an aborted provider request as a bounded timeout", async () => {
    const fetchFn = async () => {
      throw new DOMException("Aborted", "AbortError");
    };

    await expect(computeGoogleRoute({
      origin: { lat: 1, lng: 2 },
      destination: "123 Main St",
    }, {
      credentials: credentials("maps-key"),
      fetchFn,
    })).rejects.toMatchObject({ code: "timeout", status: 504 });
  });
});
