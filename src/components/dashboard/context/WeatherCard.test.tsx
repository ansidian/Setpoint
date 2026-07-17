import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import WeatherCard from "./WeatherCard";

afterEach(cleanup);

const forecastWeather = {
  temp: 72,
  high: 75,
  low: 58,
  icon: "Sun",
  summary: "Clear. High of 75°F, low of 58°F.",
  hourly: [
    { time: "1p", temp: 72, icon: "Sun", now: true },
    { time: "3p", temp: 74, icon: "Sun" },
  ],
  dailyForecast: [
    { dateKey: "2026-06-20", high: 75, low: 58, icon: "Sun" },
    { dateKey: "2026-06-21", high: 71, low: 55, icon: "CloudSun" },
    { dateKey: "2026-06-22", high: 63, low: 52, icon: "CloudRain", rain: 70 },
  ],
};

describe("WeatherCard", () => {
  it("shows the resting header and a hint, collapsed by default", () => {
    render(<WeatherCard weather={forecastWeather} />);
    expect(screen.getByText("Clear")).toBeTruthy(); // resting condition
    expect(screen.getByText("Hover for the forecast")).toBeTruthy();
    expect(screen.getByTestId("context-weather").getAttribute("aria-expanded")).toBe("false");
  });

  it("renders the forecast detail (hours + days, with the rain chip)", () => {
    render(<WeatherCard weather={forecastWeather} />);
    expect(screen.getByText("Rest of today")).toBeTruthy();
    expect(screen.getByText("Next 3 days")).toBeTruthy();
    expect(screen.getByText("Partly cloudy")).toBeTruthy(); // CloudSun day
    expect(screen.getByText("70%")).toBeTruthy(); // rain chip
  });

  it("expands on hover", () => {
    render(<WeatherCard weather={forecastWeather} />);
    const card = screen.getByTestId("context-weather");
    fireEvent.mouseEnter(card);
    expect(card.getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseLeave(card);
    expect(card.getAttribute("aria-expanded")).toBe("false");
  });

  it("degrades to a quiet, non-interactive card when there is no forecast feed", () => {
    render(<WeatherCard weather={{ temp: 72, high: 75, low: 58, icon: "Sun", summary: "Clear." }} />);
    expect(screen.getByText("72°")).toBeTruthy();
    expect(screen.queryByText("Hover for the forecast")).toBeNull();
    expect(screen.getByTestId("context-weather").getAttribute("aria-expanded")).toBeNull();
  });
});
