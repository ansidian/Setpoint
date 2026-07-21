import type { InstanceCredentialMetadata } from "../shared/types/instance-credentials.ts";
import type { InstanceCredentialService } from "./platform/instance-credential-service.ts";

export type LocationCredentialKey =
  | "weather.pirate_weather_api_key"
  | "calendar.google_places_api_key";
export type LocationCredentialTestCode =
  | "VALID"
  | "INVALID_CREDENTIAL"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "VALIDATION_FAILED";

type ValidationResponse = { ok: boolean; status: number };
type ValidationFetch = (input: string | URL | Request, init?: RequestInit) => Promise<ValidationResponse>;

export class UnknownLocationCredentialError extends Error {
  readonly code = "UNKNOWN_LOCATION_CREDENTIAL";
  readonly status = 404;

  constructor() {
    super("Location credential key is not supported");
  }
}

export class MissingPendingLocationCredentialError extends Error {
  readonly code = "LOCATION_CREDENTIAL_PENDING_REQUIRED";
  readonly status = 409;

  constructor() {
    super("A pending location credential is required");
  }
}

async function runtimeCredentialService(): Promise<InstanceCredentialService> {
  return (await import("./platform/instance-credential-service.ts")).instanceCredentialService;
}

function requireLocationCredentialKey(key: string): LocationCredentialKey {
  if (key !== "weather.pirate_weather_api_key" && key !== "calendar.google_places_api_key") {
    throw new UnknownLocationCredentialError();
  }
  return key;
}

async function resolveValue(
  key: LocationCredentialKey,
  credentials?: Pick<InstanceCredentialService, "resolve">,
): Promise<string | null> {
  const service = credentials ?? await runtimeCredentialService();
  return (await service.resolve(key)).value;
}

export function resolvePirateWeatherApiKey(
  credentials?: Pick<InstanceCredentialService, "resolve">,
): Promise<string | null> {
  return resolveValue("weather.pirate_weather_api_key", credentials);
}

export function resolveGooglePlacesApiKey(
  credentials?: Pick<InstanceCredentialService, "resolve">,
): Promise<string | null> {
  return resolveValue("calendar.google_places_api_key", credentials);
}

function validationRequest(key: LocationCredentialKey, value: string): { url: string; init: RequestInit } {
  if (key === "weather.pirate_weather_api_key") {
    return {
      url: `https://api.pirateweather.net/forecast/${encodeURIComponent(value)}/0,0?exclude=minutely,hourly,daily,alerts,flags&units=us`,
      init: { method: "GET" },
    };
  }
  return {
    url: "https://places.googleapis.com/v1/places:autocomplete",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": value,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId",
      },
      body: JSON.stringify({ input: "Setpoint", includedRegionCodes: ["us"] }),
    },
  };
}

function validationCode(status: number): LocationCredentialTestCode {
  if (status === 401 || status === 403) return "INVALID_CREDENTIAL";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return "VALIDATION_FAILED";
}

export function createLocationCredentialManager({
  credentials,
  fetchImpl = globalThis.fetch,
}: {
  credentials?: InstanceCredentialService;
  fetchImpl?: ValidationFetch;
} = {}) {
  async function testPending(keyInput: string): Promise<{
    ok: boolean;
    code: LocationCredentialTestCode;
    metadata: InstanceCredentialMetadata;
  }> {
    const key = requireLocationCredentialKey(keyInput);
    const service = credentials ?? await runtimeCredentialService();
    const pending = await service.readPending(key);
    if (!pending) throw new MissingPendingLocationCredentialError();

    let code: LocationCredentialTestCode = "PROVIDER_UNAVAILABLE";
    try {
      const request = validationRequest(key, pending.value);
      const response = await fetchImpl(request.url, request.init);
      if (response.ok) {
        const metadata = await service.promotePending(key, pending.version);
        return { ok: true, code: "VALID", metadata };
      }
      code = validationCode(response.status);
    } catch {
      code = "PROVIDER_UNAVAILABLE";
    }

    const metadata = await service.recordPendingFailure(key, pending.version, code);
    return { ok: false, code, metadata };
  }

  return { testPending };
}

export type LocationCredentialManager = ReturnType<typeof createLocationCredentialManager>;
export const locationCredentialManager = createLocationCredentialManager();
