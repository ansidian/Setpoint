import { fetchWeather } from "../../platform/weather.ts";

const weatherProvider = {
  key: "weather_current",
  cacheTtlMs: 30 * 60 * 1000,
  fallbackPayload: () => null,
  hasUsablePayload: (payload) => Boolean(payload?.temp != null || payload?.summary),
  async fetchFresh(_userId, config) {
    const settings = config.settings || {};
    return {
      ...(await fetchWeather(settings.weather_lat || 34.1442, settings.weather_lng || -117.9981)),
      location: settings.weather_location || "El Monte, CA",
    };
  },
};

export default weatherProvider;
