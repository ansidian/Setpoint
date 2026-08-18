import { resolveGoogleMapsApiKey } from "../location-credentials.ts";
import { fetchWithTimeout, type FetchFunction } from "./fetch-with-timeout.ts";
import type { InstanceCredentialService } from "./instance-credential-service.ts";

const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const GOOGLE_ROUTES_TIMEOUT_MS = 10_000;
export const GOOGLE_ROUTES_FIELD_MASK = "routes.duration,routes.distanceMeters";

export type GoogleRoutesErrorCode =
  | "maps_not_configured"
  | "routes_not_enabled"
  | "credential_rejected"
  | "destination_invalid"
  | "no_route"
  | "rate_limited"
  | "timeout"
  | "provider_unavailable"
  | "malformed_response";

export class GoogleRoutesError extends Error {
  readonly code: GoogleRoutesErrorCode;
  readonly status: number;

  constructor(
    code: GoogleRoutesErrorCode,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "GoogleRoutesError";
    this.code = code;
    this.status = status;
  }
}

export interface GoogleRouteEstimate {
  durationSeconds: number;
  distanceMeters: number;
}

type GoogleRouteRequest = {
  origin: { lat: number; lng: number };
  destination: string;
};

type GoogleRoutesOptions = {
  credentials?: Pick<InstanceCredentialService, "resolve">;
  fetchFn?: FetchFunction<Response>;
  timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerReason(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error) || !Array.isArray(value.error.details)) return null;
  for (const detail of value.error.details) {
    if (isRecord(detail) && typeof detail.reason === "string") return detail.reason;
  }
  return null;
}

function providerError(status: number, body: unknown): GoogleRoutesError {
  if (status === 429) {
    return new GoogleRoutesError("rate_limited", "Google Routes is rate limited. Try again shortly.", 429);
  }
  if (status === 408 || status === 504) {
    return new GoogleRoutesError("timeout", "Google Routes timed out. Try again.", 504);
  }
  if (status === 400 || status === 404 || status === 422) {
    return new GoogleRoutesError(
      "destination_invalid",
      "Google Routes could not resolve the event location.",
      400,
    );
  }
  if (status === 401 || status === 403) {
    const reason = providerReason(body);
    if (reason === "SERVICE_DISABLED" || reason === "API_DISABLED") {
      return new GoogleRoutesError(
        "routes_not_enabled",
        "Enable the Google Routes API for the configured Maps key.",
        409,
      );
    }
    return new GoogleRoutesError(
      "credential_rejected",
      "The configured Maps key cannot call Google Routes.",
      409,
    );
  }
  return new GoogleRoutesError(
    "provider_unavailable",
    "Google Routes is temporarily unavailable.",
    status >= 500 ? 503 : 502,
  );
}

function durationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:\.(\d{1,9}))?s$/.exec(value);
  if (!match) return null;
  const seconds = Number(match[1]);
  const nanos = match[2] ? Number(`0.${match[2]}`) : 0;
  if (!Number.isSafeInteger(seconds) || !Number.isFinite(nanos)) return null;
  return Math.ceil(seconds + nanos);
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /(?:abort|timeout)/i.test(error.message);
}

export async function computeGoogleRoute(
  { origin, destination }: GoogleRouteRequest,
  { credentials, fetchFn, timeoutMs = GOOGLE_ROUTES_TIMEOUT_MS }: GoogleRoutesOptions = {},
): Promise<GoogleRouteEstimate> {
  const apiKey = await resolveGoogleMapsApiKey(credentials);
  if (!apiKey) {
    throw new GoogleRoutesError(
      "maps_not_configured",
      "Configure a Google Maps Platform key before enabling Time to Leave.",
      409,
    );
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(GOOGLE_ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GOOGLE_ROUTES_FIELD_MASK,
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: origin.lat,
              longitude: origin.lng,
            },
          },
        },
        destination: { address: destination },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      }),
    }, { timeoutMs, fetchFn });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new GoogleRoutesError("timeout", "Google Routes timed out. Try again.", 504);
    }
    throw new GoogleRoutesError(
      "provider_unavailable",
      "Google Routes is temporarily unavailable.",
      503,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GoogleRoutesError(
      "malformed_response",
      "Google Routes returned an invalid response.",
      502,
    );
  }
  if (!response.ok) throw providerError(response.status, body);

  if (!isRecord(body) || !Array.isArray(body.routes)) {
    throw new GoogleRoutesError(
      "malformed_response",
      "Google Routes returned an invalid response.",
      502,
    );
  }
  if (!body.routes.length) {
    throw new GoogleRoutesError(
      "no_route",
      "No driving route was found for the event location.",
      400,
    );
  }

  const route = body.routes[0];
  const duration = isRecord(route) ? durationSeconds(route.duration) : null;
  const distance = isRecord(route) ? route.distanceMeters : null;
  if (
    duration === null
    || typeof distance !== "number"
    || !Number.isSafeInteger(distance)
    || distance < 0
  ) {
    throw new GoogleRoutesError(
      "malformed_response",
      "Google Routes returned an invalid response.",
      502,
    );
  }

  return { durationSeconds: duration, distanceMeters: distance };
}
