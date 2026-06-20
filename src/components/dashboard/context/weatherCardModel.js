// Pure view-model transforms for the hover-expanded weather card. Returns
// lucide icon *names* (resolved to components by WeatherCard) so these stay
// React-free and unit-testable. Colors come straight from the design tokens.
const SUN = "#f9e2af"; // warm / sunny glyphs
const RAIN = "#89b4fa"; // rain glyph + rain-chance chip
const SLATE = "rgba(205,214,244,0.55)"; // cloud / moon / neutral glyphs

function iconColor(name) {
  if (name === "Sun" || name === "Sunrise") return SUN;
  if (name === "CloudRain" || name === "CloudSnow" || name === "CloudLightning") return RAIN;
  return SLATE;
}

// Short condition labels keyed by the lucide icon name the server emits.
const COND_LABELS = {
  Sun: "Clear",
  Moon: "Clear",
  CloudSun: "Partly cloudy",
  CloudMoon: "Partly cloudy",
  Cloud: "Cloudy",
  CloudRain: "Rain",
  CloudSnow: "Snow",
  CloudFog: "Fog",
  Wind: "Windy",
  CloudLightning: "Storms",
  Tornado: "Tornado",
};

// Below this chance the rain chip is noise, so it stays hidden (the handoff
// shows the chip "only when a rain chance exists").
const RAIN_CHIP_THRESHOLD = 20;

function condLabel(name) {
  return COND_LABELS[name] || "";
}

function weekdayName(dateKey) {
  if (!dateKey) return "";
  // dateKey is an already-local "YYYY-MM-DD"; parse at noon so the weekday is
  // stable regardless of the runtime timezone.
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

const MAX_HOURS = 6;
const MAX_DAYS = 3;

export function currentCondition(weather) {
  const fromIcon = condLabel(weather?.icon);
  if (fromIcon) return fromIcon;
  // The server summary is "<condition>. High of X°F, low of Y°F." — take the
  // leading clause when the icon doesn't map to a known label.
  const summary = weather?.summary || "";
  return summary.split(".")[0].trim();
}

export function buildForecastHours(weather) {
  const hours = (weather?.hourly || []).slice(0, MAX_HOURS);
  // Keep exactly one accented "now" cell: trust the server flag, but fall back
  // to the first cell so an older payload without flags still reads correctly.
  const hasFlag = hours.some((h) => h.now);
  return hours.map((h, i) => ({
    time: h.time,
    temp: `${h.temp}°`,
    iconName: h.icon,
    color: iconColor(h.icon),
    now: hasFlag ? !!h.now : i === 0,
  }));
}

export function buildForecastDays(weather) {
  // dailyForecast[0] is today; the card shows the three days after it.
  const days = (weather?.dailyForecast || []).slice(1, 1 + MAX_DAYS);
  return days.map((d) => ({
    name: weekdayName(d.dateKey),
    cond: condLabel(d.icon),
    iconName: d.icon,
    color: iconColor(d.icon),
    hi: `${d.high}°`,
    lo: `${d.low}°`,
    rain: Number.isFinite(d.rain) && d.rain >= RAIN_CHIP_THRESHOLD ? `${d.rain}%` : null,
  }));
}
