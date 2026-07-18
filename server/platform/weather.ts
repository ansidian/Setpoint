import { createHash } from "node:crypto";
import { resolvePirateWeatherApiKey } from "../location-credentials.ts";
import type { InstanceCredentialService } from "./instance-credential-service.ts";
import { fetchWithTimeout } from "./fetch-with-timeout.ts";

const PIRATE_WEATHER_TIMEOUT_MS = 10_000;
const NOMINATIM_TIMEOUT_MS = 10_000;

// Pirate Weather (Dark Sky-compatible) condition → lucide icon name.
// Frontend resolves the name to a component via src/lib/Icon.tsx.
const ICON_MAP = {
  "clear-day": "Sun",
  "clear-night": "Moon",
  "rain": "CloudRain",
  "snow": "CloudSnow",
  "sleet": "CloudSnow",
  "wind": "Wind",
  "fog": "CloudFog",
  "cloudy": "Cloud",
  "partly-cloudy-day": "CloudSun",
  "partly-cloudy-night": "CloudMoon",
  "hail": "CloudSnow",
  "thunderstorm": "CloudLightning",
  "tornado": "Tornado",
} as const;

type WeatherPoint = {
  time: number;
  temperature: number;
  temperatureHigh: number;
  temperatureLow: number;
  precipProbability: number;
  icon: string;
  summary: string;
};

export type WeatherPayload = {
  temp: number;
  high: number;
  low: number;
  icon: string;
  timezone: string;
  summary: string;
  hourly: Array<{ time: string; temp: number; icon: string; now: boolean }>;
  dailyForecast: Array<{
    dateKey: string;
    high: number | null;
    low: number | null;
    icon: string;
    summary: string;
    rain: number | null;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNaN(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function weatherPoint(value: unknown): WeatherPoint | null {
  if (!isRecord(value)) return null;
  return {
    time: numberOrNaN(value.time),
    temperature: numberOrNaN(value.temperature),
    temperatureHigh: numberOrNaN(value.temperatureHigh),
    temperatureLow: numberOrNaN(value.temperatureLow),
    precipProbability: numberOrNaN(value.precipProbability),
    icon: typeof value.icon === "string" ? value.icon : "",
    summary: typeof value.summary === "string" ? value.summary : "",
  };
}

function nestedWeatherPoints(data: Record<string, unknown>, key: string): WeatherPoint[] {
  const container = data[key];
  if (!isRecord(container) || !Array.isArray(container.data)) return [];
  return container.data.map(weatherPoint).filter((point): point is WeatherPoint => point !== null);
}

function getIcon(iconStr: string) {
  return ICON_MAP[iconStr as keyof typeof ICON_MAP] || "Sun";
}

function formatHour(unixTime: number, timezone: string) {
  const d = new Date(unixTime * 1000);
  const h = parseInt(d.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: timezone }), 10);
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

function dateKeyForUnixTime(unixTime: number, timezone = "America/Los_Angeles") {
  if (!Number.isFinite(unixTime)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixTime * 1000));
}

export function normalizeWeatherPayload(data: unknown): WeatherPayload {
  if (!isRecord(data)) throw new Error("Pirate Weather response missing current conditions");
  const current = weatherPoint(data.currently);
  if (!current) throw new Error("Pirate Weather response missing current conditions");

  const timezone = typeof data.timezone === "string" ? data.timezone : "America/Los_Angeles";
  const daily = nestedWeatherPoints(data, "daily");
  const today = daily[0];
  const dailyForecast: WeatherPayload["dailyForecast"] = daily.flatMap((day) => {
      const dateKey = dateKeyForUnixTime(day.time, timezone);
      if (!dateKey) return [];
      const high = Number.isFinite(day.temperatureHigh) ? Math.round(day.temperatureHigh) : null;
      const low = Number.isFinite(day.temperatureLow) ? Math.round(day.temperatureLow) : null;
      return [{
        dateKey,
        high,
        low,
        icon: getIcon(day.icon),
        summary: day.summary || "",
        rain: Number.isFinite(day.precipProbability) ? Math.round(day.precipProbability * 100) : null,
      }];
    });

  // Build the "rest of today" strip every 2 hours, starting at the current hour
  // so the dashboard can accent it as "now". The current-hour bucket is the
  // entry just before the first future entry.
  const nowUnix = current.time;
  const hourly = [];
  const hours = nestedWeatherPoints(data, "hourly");
  const futureIdx = hours.findIndex((h) => h.time > nowUnix);
  let startIdx;
  if (futureIdx === -1) startIdx = hours.length ? hours.length - 1 : -1;
  else if (futureIdx === 0) startIdx = 0;
  else startIdx = futureIdx - 1;
  for (let i = startIdx; i >= 0 && i < hours.length && hourly.length < 6; i += 2) {
    const h = hours[i]!;
    hourly.push({
      time: formatHour(h.time, timezone),
      temp: Math.round(h.temperature),
      icon: getIcon(h.icon),
      now: hourly.length === 0,
    });
  }

  const high = today && Number.isFinite(today.temperatureHigh)
    ? Math.round(today.temperatureHigh)
    : Math.round(current.temperature);
  const low = today && Number.isFinite(today.temperatureLow)
    ? Math.round(today.temperatureLow)
    : Math.round(current.temperature);

  return {
    temp: Math.round(current.temperature),
    high,
    low,
    icon: getIcon(current.icon),
    timezone,
    summary: `${current.summary || ""}. High of ${high}°F, low of ${low}°F.`,
    hourly,
    dailyForecast,
  };
}

// Cache weather for 30 minutes
let weatherCache: { data: WeatherPayload | null; ts: number; key: string } = {
  data: null,
  ts: 0,
  key: "",
};
let weatherRefresh: { key: string; promise: Promise<WeatherPayload> } | null = null;
const CACHE_TTL = 30 * 60 * 1000;

export function __resetWeatherCacheForTests() {
  weatherCache = { data: null, ts: 0, key: "" };
  weatherRefresh = null;
}

async function refreshWeather(cacheKey: string, apiKey: string, lat: string | number, lng: string | number) {
  // Coalesce concurrent refreshes for the same location so a TTL lapse under the
  // /current poll loop doesn't fan out into many simultaneous Pirate Weather hits.
  if (weatherRefresh && weatherRefresh.key === cacheKey) return weatherRefresh.promise;
  const promise = (async () => {
    const url = `https://api.pirateweather.net/forecast/${encodeURIComponent(apiKey)}/${lat},${lng}?exclude=minutely,flags&units=us`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {}, { timeoutMs: PIRATE_WEATHER_TIMEOUT_MS });
    } catch {
      if (weatherCache.key === cacheKey && weatherCache.data) return weatherCache.data;
      throw new Error("Pirate Weather request failed");
    }
    if (!res.ok) {
      if (weatherCache.key === cacheKey && weatherCache.data) {
        console.warn("Pirate Weather error, returning cached data");
        return weatherCache.data;
      }
      throw new Error(`Pirate Weather error: ${res.status}`);
    }
    const data = await res.json();
    const result = normalizeWeatherPayload(data);
    weatherCache = { data: result, ts: Date.now(), key: cacheKey };
    return result;
  })();
  weatherRefresh = { key: cacheKey, promise };
  try {
    return await promise;
  } finally {
    if (weatherRefresh?.promise === promise) weatherRefresh = null;
  }
}

export async function fetchWeather(
  lat: string | number,
  lng: string | number,
  credentials?: Pick<InstanceCredentialService, "resolve">,
) {
  const apiKey = await resolvePirateWeatherApiKey(credentials);
  if (!apiKey) throw new Error("Pirate Weather is not configured");

  const credentialFingerprint = createHash("sha256").update(apiKey).digest("hex");
  const cacheKey = `${credentialFingerprint}:${lat},${lng}`;
  const cachedForKey = weatherCache.key === cacheKey && weatherCache.data;
  if (cachedForKey && Date.now() - weatherCache.ts < CACHE_TTL) {
    return weatherCache.data!;
  }

  // Stale-while-revalidate (P3-17): once we have data for this location, a TTL
  // lapse serves the stale payload immediately and refreshes in the background,
  // so no request blocks on a cold Pirate Weather fetch. Only the very first
  // (uncached) load for a location blocks.
  if (cachedForKey) {
    refreshWeather(cacheKey, apiKey, lat, lng).catch(() => {});
    return weatherCache.data!;
  }

  return refreshWeather(cacheKey, apiKey, lat, lng);
}

// Geocode using OpenStreetMap Nominatim (free, no key required)
export async function geocodeLocation(query: unknown) {
  const normalizedQuery = String(query);
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(normalizedQuery)}&format=json&limit=5&addressdetails=1`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": "Setpoint/1.0" },
  }, { timeoutMs: NOMINATIM_TIMEOUT_MS });
  if (!res.ok) throw new Error(`Geocoding error: ${res.status}`);
  const data: unknown = await res.json();

  if (!Array.isArray(data) || !data.length) {
    throw new Error(`No results found for "${normalizedQuery}"`);
  }

  return data.filter(isRecord).map((result) => ({
    name: typeof result.display_name === "string" ? result.display_name : "",
    lat: parseFloat(typeof result.lat === "string" ? result.lat : ""),
    lng: parseFloat(typeof result.lon === "string" ? result.lon : ""),
  }));
}
