import { fetchWeather } from "../../platform/weather.ts";
import type { CurrentDashboardProvider } from "../current-types.ts";

function weatherPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const weatherProvider: CurrentDashboardProvider = {
  key: "weather_current",
  cacheTtlMs: 30 * 60 * 1000,
  fallbackPayload: () => null,
  hasUsablePayload: (payload) => {
    const value = weatherPayload(payload);
    return Boolean(value?.temp != null || value?.summary);
  },
  async fetchFresh(_userId, config) {
    const settings = config.settings;
    return {
      ...(await fetchWeather(
        settings?.weather_lat as string | number || 34.1442,
        settings?.weather_lng as string | number || -117.9981,
      )),
      location: String(settings?.weather_location || "El Monte, CA"),
    };
  },
};

export default weatherProvider;
