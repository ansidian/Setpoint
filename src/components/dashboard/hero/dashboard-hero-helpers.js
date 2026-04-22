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
  urgencyForDays,
} from "../../../lib/redesign-helpers";
import { daysUntil } from "../../../lib/bill-utils";
import { resolveInsight } from "../../../lib/insight-resolver";

export const WEATHER_ICONS = {
  Sun,
  Cloud,
  CloudSun,
  CloudRain,
  Snowflake,
  CloudFog,
  Moon,
};

export function buildHeroCallouts({ events, deadlines, bills, now }) {
  const out = [];
  const nextEvent = (events || []).find((e) => e.startMs && e.startMs > now && e.startMs - now < 4 * 3600000);
  if (nextEvent) {
    const mins = Math.round((nextEvent.startMs - now) / 60000);
    out.push({
      kind: "event",
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
      icon: CreditCard,
      lead: daysLabel(days),
      title: b.name,
      sub: `$${Number(b.amount || 0).toFixed(2)} · ${b.payee || ""}`,
      urgency: urgencyForDays(days).key,
      date: b.next_date,
    });
  }

  return out.slice(0, 3);
}

export function buildHeroStateOfDay(briefing, now) {
  const insights = briefing?.aiInsights || [];
  const top = insights[0];
  const headline = top ? resolveInsight(top, new Date(now)) : "";
  const summary = briefing?.emails?.summary || "";
  return { headline, summary };
}
