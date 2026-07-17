import {
  Mail, Apple, Briefcase, School, GraduationCap, Home, DollarSign, ShoppingCart,
  Bell, Gamepad2, Music, Smartphone, Monitor, Wrench, Star, Rocket,
  Sun, Moon, Cloud, CloudMoon, CloudRain, CloudLightning, CloudFog, CloudSun, CloudSnow,
  Snowflake, Wind, Tornado,
  Lightbulb, Calendar, Clock, ClipboardList, CreditCard, AlertTriangle, Lock,
  Film, Plane, Target, PartyPopper, Pin, Link as LinkIcon, BarChart3, Sparkles,
  Heart, CheckCircle2, XCircle, HelpCircle, Package, Activity,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Registry of known lucide icons, addressed by stable string name.
// Stored in the DB (account.icon) and emitted from the server (weather, briefings).
export const ICON_BY_NAME = {
  Mail, Apple, Briefcase, School, GraduationCap, Home, DollarSign, ShoppingCart,
  Bell, Gamepad2, Music, Smartphone, Monitor, Wrench, Star, Rocket,
  Sun, Moon, Cloud, CloudMoon, CloudRain, CloudLightning, CloudFog, CloudSun, CloudSnow,
  Snowflake, Wind, Tornado,
  Lightbulb, Calendar, Clock, ClipboardList, CreditCard, AlertTriangle, Lock,
  Film, Plane, Target, PartyPopper, Pin, Link: LinkIcon, BarChart3, Sparkles,
  Heart, CheckCircle2, XCircle, HelpCircle, Package, Activity,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICON_BY_NAME;

// Back-compat: historical data (briefings, saved account.icon) may contain
// emojis. Map them to the closest lucide icon so existing state still renders.
export const EMOJI_TO_LUCIDE = {
  "📧": "Mail",
  "🍎": "Apple",
  "💼": "Briefcase",
  "🏫": "School",
  "🎓": "GraduationCap",
  "🏠": "Home",
  "💰": "DollarSign",
  "🛒": "ShoppingCart",
  "🔔": "Bell",
  "🎮": "Gamepad2",
  "🎵": "Music",
  "📱": "Smartphone",
  "🖥️": "Monitor",
  "🔧": "Wrench",
  "⭐": "Star",
  "🚀": "Rocket",
  "☀️": "Sun",
  "🌙": "Moon",
  "☁️": "Cloud",
  "🌧️": "CloudRain",
  "⛈️": "CloudLightning",
  "🌫️": "CloudFog",
  "⛅": "CloudSun",
  "🌨️": "CloudSnow",
  "❄️": "Snowflake",
  "💨": "Wind",
  "🌪️": "Tornado",
  "💡": "Lightbulb",
  "📅": "Calendar",
  "⏰": "Clock",
  "📋": "ClipboardList",
  "💳": "CreditCard",
  "⚠️": "AlertTriangle",
  "⚠": "AlertTriangle",
  "🔒": "Lock",
  "🎬": "Film",
  "🛫": "Plane",
  "✈️": "Plane",
  "🎯": "Target",
  "🎉": "PartyPopper",
  "📌": "Pin",
  "🔗": "Link",
  "📊": "BarChart3",
  "✨": "Sparkles",
  "❤️": "Heart",
  "✅": "CheckCircle2",
  "❌": "XCircle",
  "📦": "Package",
  "🏃": "Activity",
} as const satisfies Record<string, IconName>;

// Options shown in Settings account-icon picker (order matters — first two
// match stored Gmail/iCloud defaults).
export const ACCOUNT_ICON_OPTIONS = [
  "Mail", "Apple", "Briefcase", "School", "GraduationCap", "Home",
  "DollarSign", "ShoppingCart", "Bell", "Gamepad2", "Music", "Smartphone",
  "Monitor", "Wrench", "Star", "Rocket",
] as const satisfies readonly IconName[];

// Pirate Weather condition code → lucide icon name.
export const WEATHER_ICON_NAMES = {
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
} as const satisfies Record<string, IconName>;

// Resolve any input — lucide name, emoji, or unknown string — to a lucide
// component when possible.
export function resolveIcon(value: unknown): LucideIcon | null {
  if (typeof value !== "string" || !value) return null;
  const iconRegistry: Readonly<Record<string, LucideIcon>> = ICON_BY_NAME;
  if (iconRegistry[value]) return iconRegistry[value]!;
  const mapped = (EMOJI_TO_LUCIDE as Readonly<Record<string, IconName>>)[value];
  if (mapped) return ICON_BY_NAME[mapped];
  return null;
}
