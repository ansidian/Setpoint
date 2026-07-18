import { describe, expect, it, vi } from "vitest";
import {
  createLocationCredentialManager,
  resolveGooglePlacesApiKey,
  resolvePirateWeatherApiKey,
} from "./location-credentials.ts";

describe("location provider credentials", () => {
  it("resolves weather and Places keys from the runtime registry", async () => {
    const resolve = vi.fn(async (key: string) => ({ key, source: "environment", value: `${key}-value` }));

    await expect(resolvePirateWeatherApiKey({ resolve } as never)).resolves.toBe("weather.pirate_weather_api_key-value");
    await expect(resolveGooglePlacesApiKey({ resolve } as never)).resolves.toBe("calendar.google_places_api_key-value");
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("tests and promotes a valid pending weather key without returning it", async () => {
    const credentials = {
      readPending: vi.fn(async () => ({ value: "candidate-weather-secret", version: 3 })),
      promotePending: vi.fn(async () => ({ key: "weather.pirate_weather_api_key", version: 4 })),
      recordPendingFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("candidate-weather-secret");
      return { ok: true, status: 200 };
    });
    const manager = createLocationCredentialManager({ credentials: credentials as never, fetchImpl: fetchImpl as never });

    const result = await manager.testPending("weather.pirate_weather_api_key");

    expect(result).toEqual({ ok: true, code: "VALID", metadata: { key: "weather.pirate_weather_api_key", version: 4 } });
    expect(JSON.stringify(result)).not.toContain("candidate-weather-secret");
    expect(credentials.promotePending).toHaveBeenCalledWith("weather.pirate_weather_api_key", 3);
  });

  it("records a redacted Places failure while preserving the active key", async () => {
    const credentials = {
      readPending: vi.fn(async () => ({ value: "bad-places-secret", version: 7 })),
      promotePending: vi.fn(),
      recordPendingFailure: vi.fn(async () => ({ key: "calendar.google_places_api_key", version: 8 })),
      resolve: vi.fn(async () => ({ key: "calendar.google_places_api_key", source: "stored", value: "working-places-secret" })),
    };
    const manager = createLocationCredentialManager({
      credentials: credentials as never,
      fetchImpl: vi.fn(async () => ({ ok: false, status: 403 })) as never,
    });

    const result = await manager.testPending("calendar.google_places_api_key");

    expect(result).toEqual({
      ok: false,
      code: "INVALID_CREDENTIAL",
      metadata: { key: "calendar.google_places_api_key", version: 8 },
    });
    expect(JSON.stringify(result)).not.toContain("bad-places-secret");
    expect(credentials.recordPendingFailure).toHaveBeenCalledWith("calendar.google_places_api_key", 7, "INVALID_CREDENTIAL");
    await expect(resolveGooglePlacesApiKey(credentials as never)).resolves.toBe("working-places-secret");
  });
});
