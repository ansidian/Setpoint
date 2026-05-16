const PIRATE_WEATHER_API_KEY = process.env.PIRATE_WEATHER_API_KEY;

// Pirate Weather (Dark Sky-compatible) condition → lucide icon name.
// Frontend resolves the name to a component via src/lib/icons.jsx.
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
};

function getIcon(iconStr) {
  return ICON_MAP[iconStr] || "Sun";
}

function formatHour(unixTime, timezone) {
  const d = new Date(unixTime * 1000);
  const h = parseInt(d.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: timezone }), 10);
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

function dateKeyForUnixTime(unixTime, timezone = "America/Los_Angeles") {
  if (!Number.isFinite(unixTime)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixTime * 1000));
}

export function normalizeWeatherPayload(data) {
  const current = data?.currently;
  if (!current) throw new Error("Pirate Weather response missing current conditions");

  const timezone = data.timezone || "America/Los_Angeles";
  const today = data.daily?.data?.[0];
  const dailyForecast = (data.daily?.data || [])
    .map((day) => {
      const dateKey = dateKeyForUnixTime(day.time, timezone);
      if (!dateKey) return null;
      const high = Number.isFinite(day.temperatureHigh) ? Math.round(day.temperatureHigh) : null;
      const low = Number.isFinite(day.temperatureLow) ? Math.round(day.temperatureLow) : null;
      return {
        dateKey,
        high,
        low,
        icon: getIcon(day.icon),
        summary: day.summary || "",
      };
    })
    .filter(Boolean);

  // Build hourly, every 2 hours starting from the next future hour.
  const nowUnix = current.time;
  const hourly = [];
  const hours = data.hourly?.data || [];
  const startIdx = hours.findIndex((h) => h.time > nowUnix);
  for (let i = startIdx; i >= 0 && i < hours.length && hourly.length < 8; i += 2) {
    const h = hours[i];
    hourly.push({
      time: formatHour(h.time, timezone),
      temp: Math.round(h.temperature),
      icon: getIcon(h.icon),
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
let weatherCache = { data: null, ts: 0, key: "" };
const CACHE_TTL = 30 * 60 * 1000;

export async function fetchWeather(lat, lng) {
  if (!PIRATE_WEATHER_API_KEY) throw new Error("PIRATE_WEATHER_API_KEY not set");

  const cacheKey = `${lat},${lng}`;
  if (weatherCache.key === cacheKey && Date.now() - weatherCache.ts < CACHE_TTL && weatherCache.data) {
    return weatherCache.data;
  }

  const url = `https://api.pirateweather.net/forecast/${PIRATE_WEATHER_API_KEY}/${lat},${lng}?exclude=minutely,flags&units=us`;

  const res = await fetch(url);
  if (!res.ok) {
    if (weatherCache.data) {
      console.warn("Pirate Weather error, returning cached data");
      return weatherCache.data;
    }
    const text = await res.text();
    throw new Error(`Pirate Weather error: ${res.status} ${text}`);
  }

  const data = await res.json();
  const result = normalizeWeatherPayload(data);

  weatherCache = { data: result, ts: Date.now(), key: cacheKey };
  return result;
}

// Geocode using OpenStreetMap Nominatim (free, no key required)
export async function geocodeLocation(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Setpoint/1.0" },
  });
  if (!res.ok) throw new Error(`Geocoding error: ${res.status}`);
  const data = await res.json();

  if (!data.length) {
    throw new Error(`No results found for "${query}"`);
  }

  return data.map((r) => ({
    name: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}
