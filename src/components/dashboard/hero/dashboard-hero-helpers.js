import {
  AlertCircle,
  Calendar,
  Cloud,
  CloudFog,
  CloudRain,
  CloudSun,
  CreditCard,
  Moon,
  Plane,
  Snowflake,
  Sun,
  Video,
} from "lucide-react";
import {
  daysLabel,
  formatDuration,
  getEventSelectionId,
  urgencyForDays,
} from "../../../lib/redesign-helpers";
import { daysUntil } from "../../../lib/bill-utils";

export const WEATHER_ICONS = {
  Sun,
  Cloud,
  CloudSun,
  CloudRain,
  Snowflake,
  CloudFog,
  Moon,
};

const PACIFIC_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
});

function dateKeyFromMs(ms) {
  if (!Number.isFinite(ms)) return null;
  return PACIFIC_DATE_FORMATTER.format(new Date(ms));
}

export function buildHeroCallouts({ events, deadlines, bills, now }) {
  const out = [];
  const nextEvent = (events || []).find((e) => e.startMs && e.startMs > now && e.startMs - now < 4 * 3600000);
  if (nextEvent) {
    const mins = Math.round((nextEvent.startMs - now) / 60000);
    out.push({
      kind: "event",
      id: getEventSelectionId(nextEvent),
      date: dateKeyFromMs(nextEvent.startMs),
      data: nextEvent,
      icon: nextEvent.hangoutLink || /zoom/i.test(nextEvent.location || "") ? Video
        : /flight|airport/i.test(nextEvent.title || "") ? Plane
        : Calendar,
      lead: `In ${formatDuration(mins)}`,
      title: nextEvent.title,
      sub: (nextEvent.attendees && nextEvent.attendees.length)
        ? `with ${nextEvent.attendees.slice(0, 2).join(", ")}${nextEvent.attendees.length > 2 ? ` +${nextEvent.attendees.length - 2}` : ""}`
        : nextEvent.location,
      urgency: mins < 10 ? "high" : mins < 45 ? "medium" : "low",
    });
  }

  const sortedDeadlines = [...(deadlines || [])]
    .map((d) => ({ d, days: daysUntil(d.due_date) }))
    .filter((x) => x.days != null && x.days <= 7 && x.d.status !== "complete")
    .sort((a, b) => a.days - b.days);
  if (sortedDeadlines[0]) {
    const { d, days } = sortedDeadlines[0];
    out.push({
      kind: "deadline",
      id: d.id != null ? String(d.id) : null,
      date: d.due_date || null,
      data: d,
      icon: AlertCircle,
      lead: daysLabel(days),
      title: d.title,
      sub: d.class_name || d.source,
      urgency: urgencyForDays(days).key,
    });
  }

  const sortedBills = [...(bills || [])]
    .map((b) => ({ b, days: daysUntil(b.next_date) }))
    .filter((x) => x.days != null && x.days <= 5 && !x.b.paid)
    .sort((a, b) => a.days - b.days);
  if (sortedBills[0] && out.length < 3) {
    const { b, days } = sortedBills[0];
    out.push({
      kind: "bill",
      id: b.id != null ? String(b.id) : null,
      icon: CreditCard,
      lead: daysLabel(days),
      title: b.name,
      sub: `$${Number(b.amount || 0).toFixed(2)} · ${b.payee || ""}`,
      urgency: urgencyForDays(days).key,
      date: b.next_date,
      data: b,
    });
  }

  return out.slice(0, 3);
}

export function buildHeroStateOfDay(briefing) {
  const summary = briefing?.emails?.summary || "";
  return { headline: "", summary };
}
