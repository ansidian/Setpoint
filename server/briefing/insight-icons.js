// Allowed insight icons. The email AI is prompted to pick from this list and the
// tool schema constrains it via JSON-schema `enum`. Anything that leaks
// through (e.g., historical briefings loaded from the DB, or a model that
// ignores the schema) is normalized to a safe fallback.
//
// Names are the lucide-react component names — the frontend renders them via
// src/lib/icons.jsx.
export const ALLOWED_INSIGHT_ICONS = [
  "Lightbulb",      // generic insight / idea (default)
  "Calendar",       // scheduling, events
  "Clock",          // deadlines, timing
  "CreditCard",     // bills, payments, subscriptions
  "DollarSign",     // money / spending
  "Mail",           // emails, correspondence
  "Plane",          // travel
  "Film",           // entertainment, media
  "Target",         // goals, focus
  "AlertTriangle",  // warnings, anomalies
  "Package",        // shipping, deliveries
  "Sparkles",       // generic / fallback
  "BarChart3",      // trends, stats
  "PartyPopper",    // celebrations, milestones
  "History",        // recurring, prior briefings
  "CheckCircle2",   // done, confirmed
  "GraduationCap",  // academic
  "Heart",          // personal, health
  "Music",          // music / audio
  "Activity",       // fitness, activity
  "ShoppingCart",   // purchases
  "Bell",           // reminders
];

const ALLOWED_SET = new Set(ALLOWED_INSIGHT_ICONS);
const FALLBACK_ICON = "Sparkles";

// Emoji → allowed-icon name. Duplicated intentionally from src/lib/icons.js
// so the server doesn't reach into frontend code; the lists should stay in
// sync manually.
const EMOJI_TO_ICON = {
  "💡": "Lightbulb",
  "📅": "Calendar",
  "⏰": "Clock",
  "💳": "CreditCard",
  "💰": "DollarSign",
  "📧": "Mail",
  "🛫": "Plane",
  "✈️": "Plane",
  "🎬": "Film",
  "🎯": "Target",
  "⚠️": "AlertTriangle",
  "⚠": "AlertTriangle",
  "📦": "Package",
  "✨": "Sparkles",
  "📊": "BarChart3",
  "🎉": "PartyPopper",
  "✅": "CheckCircle2",
  "🎓": "GraduationCap",
  "❤️": "Heart",
  "🎵": "Music",
  "🏃": "Activity",
  "🛒": "ShoppingCart",
  "🔔": "Bell",
  "📋": "Sparkles",        // ClipboardList isn't in the allow-list for insights
  "🔒": "AlertTriangle",
  "❌": "AlertTriangle",
};

// Coerce any incoming icon value (lucide name, emoji, or unknown) to one of
// the ALLOWED_INSIGHT_ICONS. Never returns anything outside that set.
export function normalizeInsightIcon(raw) {
  if (typeof raw !== "string" || !raw) return FALLBACK_ICON;
  if (ALLOWED_SET.has(raw)) return raw;
  const mapped = EMOJI_TO_ICON[raw];
  if (mapped && ALLOWED_SET.has(mapped)) return mapped;
  return FALLBACK_ICON;
}
