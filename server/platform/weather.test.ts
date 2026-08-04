import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearWeatherCache,
  fetchWeather,
  geocodeLocation,
  normalizeWeatherPayload,
} from "./weather.ts";

describe("normalizeWeatherPayload", () => {
  it("preserves provider fields and adds current icon, timezone, and daily forecast", () => {
    const weather = normalizeWeatherPayload({
      timezone: "America/Los_Angeles",
      currently: {
        time: 1777651200,
        temperature: 63.4,
        summary: "Partly cloudy",
        icon: "partly-cloudy-night",
      },
      hourly: {
        data: [
          { time: 1777651200, temperature: 63, icon: "clear-night" },
          { time: 1777654800, temperature: 62, icon: "clear-night" },
          { time: 1777662000, temperature: 61, icon: "partly-cloudy-night" },
        ],
      },
      daily: {
        data: [
          {
            time: 1777618800,
            temperatureHigh: 72.2,
            temperatureLow: 54.6,
            icon: "clear-day",
            summary: "Clear",
          },
          {
            time: 1777705200,
            temperatureHigh: 70.1,
            temperatureLow: 53.2,
            icon: "partly-cloudy-night",
            summary: "Clouds late",
            precipProbability: 0.7,
          },
        ],
      },
    });

    expect(weather).toMatchObject({
      temp: 63,
      high: 72,
      low: 55,
      icon: "CloudMoon",
      timezone: "America/Los_Angeles",
    });
    // The strip starts at the current hour and flags it as "now"; that is the
    // single accented cell on the dashboard.
    expect(weather.hourly[0]).toMatchObject({ temp: 63, icon: "Moon", now: true });
    expect(weather.hourly.filter((h) => h.now)).toHaveLength(1);
    expect(weather.dailyForecast).toEqual([
      { dateKey: "2026-05-01", high: 72, low: 55, icon: "Sun", summary: "Clear", rain: null },
      { dateKey: "2026-05-02", high: 70, low: 53, icon: "CloudMoon", summary: "Clouds late", rain: 70 },
    ]);
  });
});

describe("fetchWeather caching", () => {
  const credentials = (value: string | null) => ({
    resolve: vi.fn(async () => ({
      key: "weather.pirate_weather_api_key" as const,
      source: value ? "stored" as const : "disabled" as const,
      value,
    })),
  });
  const payload = (temperature: number) => ({
    timezone: "America/Los_Angeles",
    currently: { time: 1777651200, temperature, summary: "Clear", icon: "clear-day" },
    daily: { data: [] },
    hourly: { data: [] },
  });
  const okResponse = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  beforeEach(() => {
    clearWeatherCache();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves the cached payload within the TTL without re-fetching", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse(payload(60)));

    const service = credentials("test-key");
    const first = await fetchWeather(1.01, 1.01, service as never);
    const second = await fetchWeather(1.01, 1.01, service as never);

    expect(first.temp).toBe(60);
    expect(second).toBe(first);
    // test-architecture: allow-boundary-interaction -- Global fetch is the outbound weather-provider boundary; one request proves a cache hit does not duplicate provider traffic.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves stale data immediately on TTL lapse and refreshes in the background", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okResponse(payload(60)))
      .mockResolvedValueOnce(okResponse(payload(75)));

    const service = credentials("test-key");
    const first = await fetchWeather(2.02, 2.02, service as never);
    expect(first.temp).toBe(60);

    vi.setSystemTime(new Date("2026-05-01T00:31:00.000Z")); // past the 30-min TTL
    const stale = await fetchWeather(2.02, 2.02, service as never);

    // Stale payload returns immediately; once the background refresh settles,
    // the next read observes the refreshed cache value.
    expect(stale.temp).toBe(60);
    await vi.waitFor(async () => {
      expect((await fetchWeather(2.02, 2.02, service as never)).temp).toBe(75);
    });
  });

  it("throws on fetch failure when there is no cached data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));

    await expect(fetchWeather(3.03, 3.03, credentials("test-key") as never)).rejects.toThrow(/Pirate Weather error/);
  });

  it("sends the Pirate Weather request with an AbortSignal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse(payload(60)));

    await fetchWeather(4.04, 4.04, credentials("test-key") as never);

    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses a rotated key immediately and does not reuse the prior key's cache", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okResponse(payload(60)))
      .mockResolvedValueOnce(okResponse(payload(75)));
    const firstService = credentials("first-secret");
    const rotatedService = credentials("rotated-secret");

    expect((await fetchWeather(5.05, 5.05, firstService as never)).temp).toBe(60);
    expect((await fetchWeather(5.05, 5.05, rotatedService as never)).temp).toBe(75);

    expect(String(fetchMock.mock.calls[0]![0])).toContain("first-secret");
    expect(String(fetchMock.mock.calls[1]![0])).toContain("rotated-secret");
  });

  it("does not serve cached weather after the credential is disabled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse(payload(60)));
    await fetchWeather(6.06, 6.06, credentials("working-secret") as never);

    await expect(fetchWeather(6.06, 6.06, credentials(null) as never)).rejects.toThrow("Pirate Weather is not configured");
  });
});

describe("geocodeLocation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the Nominatim geocode request with an AbortSignal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([
      { display_name: "Somewhere", lat: "1.0", lon: "2.0" },
    ]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await geocodeLocation("Somewhere");

    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
