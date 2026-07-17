import { describe, it, expect } from "vitest";
import { buildForecastHours, buildForecastDays, currentCondition } from "./weatherCardModel";

describe("buildForecastHours", () => {
  it("maps the server hourly feed to display rows, accenting the now cell", () => {
    const weather = {
      hourly: [
        { time: "1p", temp: 72, icon: "Sun", now: true },
        { time: "3p", temp: 74, icon: "Sun" },
        { time: "5p", temp: 67, icon: "CloudSun" },
      ],
    };

    const rows = buildForecastHours(weather);

    expect(rows).toEqual([
      { time: "1p", temp: "72°", iconName: "Sun", color: "#f9e2af", now: true },
      { time: "3p", temp: "74°", iconName: "Sun", color: "#f9e2af", now: false },
      { time: "5p", temp: "67°", iconName: "CloudSun", color: "rgba(205,214,244,0.55)", now: false },
    ]);
  });

  it("falls back to the first cell when no hour is flagged now, keeping exactly one accent", () => {
    const rows = buildForecastHours({
      hourly: [
        { time: "1p", temp: 72, icon: "Sun" },
        { time: "3p", temp: 74, icon: "Sun" },
      ],
    });
    expect(rows.map((r) => r.now)).toEqual([true, false]);
  });

  it("caps the strip at six cells and returns [] when there is no hourly feed", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ time: `${i}p`, temp: 60 + i, icon: "Sun" }));
    expect(buildForecastHours({ hourly: many })).toHaveLength(6);
    expect(buildForecastHours(undefined)).toEqual([]);
    expect(buildForecastHours({})).toEqual([]);
  });
});

describe("buildForecastDays", () => {
  const weather = {
    dailyForecast: [
      { dateKey: "2026-06-20", high: 75, low: 58, icon: "Sun" }, // today — excluded
      { dateKey: "2026-06-21", high: 71, low: 55, icon: "CloudSun" },
      { dateKey: "2026-06-22", high: 63, low: 52, icon: "CloudRain", rain: 70 },
      { dateKey: "2026-06-23", high: 70, low: 54, icon: "Sun", rain: 5 },
    ],
  };

  it("returns the next three days with weekday name, condition label, and hi/lo", () => {
    const rows = buildForecastDays(weather);

    expect(rows).toEqual([
      { name: "Sun", cond: "Partly cloudy", iconName: "CloudSun", color: "rgba(205,214,244,0.55)", hi: "71°", lo: "55°", rain: null },
      { name: "Mon", cond: "Rain", iconName: "CloudRain", color: "#89b4fa", hi: "63°", lo: "52°", rain: "70%" },
      { name: "Tue", cond: "Clear", iconName: "Sun", color: "#f9e2af", hi: "70°", lo: "54°", rain: null },
    ]);
  });

  it("returns [] when there is no daily forecast", () => {
    expect(buildForecastDays(undefined)).toEqual([]);
    expect(buildForecastDays({ dailyForecast: [{ dateKey: "2026-06-20", high: 75, low: 58, icon: "Sun" }] })).toEqual([]);
  });
});

describe("currentCondition", () => {
  it("derives a short label from the current icon", () => {
    expect(currentCondition({ icon: "CloudSun" })).toBe("Partly cloudy");
    expect(currentCondition({ icon: "Sun" })).toBe("Clear");
  });

  it("falls back to the first clause of the summary when the icon is unknown", () => {
    expect(currentCondition({ summary: "Drizzle later. High of 60°F, low of 50°F." })).toBe("Drizzle later");
    expect(currentCondition(undefined)).toBe("");
  });
});
