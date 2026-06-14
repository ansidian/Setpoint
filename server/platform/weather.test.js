import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fetchWeather captures PIRATE_WEATHER_API_KEY at module load, so set it before import.
vi.hoisted(() => {
  process.env.PIRATE_WEATHER_API_KEY = "test-key";
});

import {
  __resetWeatherCacheForTests,
  fetchWeather,
  normalizeWeatherPayload,
} from "./weather.js";

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
    expect(weather.hourly[0]).toMatchObject({ temp: 62, icon: "Moon" });
    expect(weather.dailyForecast).toEqual([
      { dateKey: "2026-05-01", high: 72, low: 55, icon: "Sun", summary: "Clear" },
      { dateKey: "2026-05-02", high: 70, low: 53, icon: "CloudMoon", summary: "Clouds late" },
    ]);
  });
});

describe("fetchWeather caching", () => {
  const payload = (temperature) => ({
    timezone: "America/Los_Angeles",
    currently: { time: 1777651200, temperature, summary: "Clear", icon: "clear-day" },
    daily: { data: [] },
    hourly: { data: [] },
  });
  const okResponse = (body) => ({ ok: true, json: async () => body, text: async () => "" });

  beforeEach(() => {
    __resetWeatherCacheForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves the cached payload within the TTL without re-fetching", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse(payload(60)));

    const first = await fetchWeather(1.01, 1.01);
    const second = await fetchWeather(1.01, 1.01);

    expect(first.temp).toBe(60);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves stale data immediately on TTL lapse and refreshes in the background", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okResponse(payload(60)))
      .mockResolvedValueOnce(okResponse(payload(75)));

    const first = await fetchWeather(2.02, 2.02);
    expect(first.temp).toBe(60);

    vi.setSystemTime(new Date("2026-05-01T00:31:00.000Z")); // past the 30-min TTL
    const stale = await fetchWeather(2.02, 2.02);

    // Stale payload returned immediately, and a background refresh was issued
    // (the second fetch) rather than blocking the caller on it.
    expect(stale.temp).toBe(60);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on fetch failure when there is no cached data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });

    await expect(fetchWeather(3.03, 3.03)).rejects.toThrow(/Pirate Weather error/);
  });
});
