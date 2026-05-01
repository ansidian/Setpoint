import { describe, expect, it } from "vitest";
import { normalizeWeatherPayload } from "./weather.js";

describe("normalizeWeatherPayload", () => {
  it("preserves legacy fields and adds current icon, timezone, and daily forecast", () => {
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
