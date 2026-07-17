import { memo } from "react";
import {
  Calendar,
  Bell,
  CheckCircle2,
  Circle,
  CircleDashed,
  Coffee,
  Flag,
  Plane,
  Users,
  Video,
} from "lucide-react";
import GoogleSpecialDateBadge from "../../calendar/GoogleSpecialDateBadge";
import {
  googleSpecialDateAccent,
  isGoogleSpecialDateEvent,
} from "../../calendar/googleSpecialDateModel";
import {
  formatEventDuration,
  formatEventTime,
  getEventSelectionId,
  urgencyForDays,
} from "../../../lib/shell-helpers";
import { daysUntil } from "../../../lib/bill-utils";
import { PRIORITY_COLOR } from "./timeline-helpers";
import { TODOIST_DEADLINE_COLOR } from "../../../../shared/deadline-source-colors";
import type { LucideIcon } from "lucide-react";
type TimelineRowEvent = {
  id?: string;
  subtitle?: string;
  startMs: number;
  endMs?: number | null;
  allDay?: boolean;
  location?: string;
  hangoutLink?: string | null;
  title?: string;
  attendees?: string[];
  color?: string;
  sourceColor?: string;
  [key: string]: unknown;
};
type TimelineRowDeadline = {
  id?: string;
  status?: string;
  project_name?: string;
  due_date?: string | null;
  due_time?: string | null;
  title?: string;
  class_name?: string;
  priority?: number | null;
  color?: string;
  sourceColor?: string;
  [key: string]: unknown;
};
export type TimelineRowItem =
  | { kind: "event"; data: TimelineRowEvent; startMs?: number; endMs?: number | null }
  | { kind: "deadline"; data: TimelineRowDeadline; dueAtMs?: number };
export type TimelineRowJumpPayload = {
  kind: "event" | "deadline";
  id: string | null | undefined;
  data: TimelineRowEvent | TimelineRowDeadline;
};

export interface TimelineRowProps {
  accent: string;
  isMobile?: boolean;
  isLive?: boolean;
  isPast?: boolean;
  item: TimelineRowItem;
  liveMarker?: { pct: number; label: string } | null;
  onJump?: (payload: TimelineRowJumpPayload, anchor: HTMLElement) => void;
  overdueText?: string | null;
  reminderSummary?: string | null;
}

function PriorityFlag({ level, size = 11 }: { level: keyof typeof PRIORITY_COLOR; size?: number }) {
  const color = PRIORITY_COLOR[level];
  if (!color) return null;

  return (
    <span
      title={`P${level}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 4,
        height: size + 4,
        borderRadius: 4,
        background: `${color}1e`,
        border: `1px solid ${color}38`,
        flexShrink: 0,
      }}
    >
      <Flag size={size - 2} color={color} strokeWidth={2.2} />
    </span>
  );
}

function TimelineRow({
  accent,
  isMobile = false,
  isLive = false,
  isPast = false,
  item,
  liveMarker = null,
  onJump,
  overdueText = null,
  reminderSummary = null,
}: TimelineRowProps) {
  let Icon: LucideIcon | null;
  let iconColor: string | undefined;
  let title: string | undefined;
  let sub: string | undefined;
  let meta: string;
  let leftLabel: string;
  let urgency: "high" | "medium" | "low";
  let jumpPayload: TimelineRowJumpPayload;
  let priorityLevel: keyof typeof PRIORITY_COLOR | null = null;
  let railDotColor: string | null = null;

  if (item.kind === "event") {
    const event = item.data;
    const specialDate = isGoogleSpecialDateEvent(event);
    const isAllDayEvent = !!event.allDay;
    Icon = specialDate ? null
      : /zoom|video/i.test(event.location || "") || event.hangoutLink ? Video
      : /flight|airport|plane/i.test(event.title || "") ? Plane
      : /coffee|lunch|dinner/i.test(event.title || "") ? Coffee
      : (event.attendees?.length || 0) > 1 ? Users
      : Calendar;
    leftLabel = specialDate ? "" : isAllDayEvent ? "All day" : formatEventTime(event.startMs);
    title = event.title;
    const attendeeCount = event.attendees?.length || 0;
    sub = specialDate ? ""
      : attendeeCount
      ? `with ${event.attendees!.slice(0, 3).join(", ")}${attendeeCount > 3 ? ` +${attendeeCount - 3}` : ""}`
      : event.location || event.subtitle;
    meta = isAllDayEvent ? "" : formatEventDuration(event.startMs, event.endMs);
    urgency = isLive ? "high" : "low";
    railDotColor = specialDate ? googleSpecialDateAccent(event) : event.color || event.sourceColor || accent;
    jumpPayload = { kind: "event", id: getEventSelectionId(event), data: event };
  } else if (item.kind === "deadline") {
    const deadline = item.data;
    const days = daysUntil(deadline.due_date);
    urgency = urgencyForDays(days, accent).key;
    Icon = deadline.status === "complete" ? CheckCircle2
      : deadline.status === "in_progress" ? CircleDashed
      : Circle;
    iconColor = deadline.status === "complete" ? "var(--sp-green)"
      : deadline.status === "in_progress" ? "var(--sp-cyan)"
      : "rgba(205,214,244,0.55)";
    leftLabel = deadline.due_time || "11:59p";
    title = deadline.title;
    sub = deadline.class_name || deadline.project_name || "";
    meta = "Deadline";
    if (deadline.priority && deadline.priority in PRIORITY_COLOR) {
      priorityLevel = deadline.priority as keyof typeof PRIORITY_COLOR;
    }
    railDotColor = priorityLevel
      ? PRIORITY_COLOR[priorityLevel]
      : deadline.color || deadline.sourceColor || TODOIST_DEADLINE_COLOR || accent;
    jumpPayload = { kind: "deadline", id: deadline.id, data: deadline };
  } else {
    return null;
  }

  // literal hexes: these flow into `${effectiveRailDotColor}NN` hex-alpha concat below; a var(--sp-*) would break it
  const urgencyColors: Record<typeof urgency, string> = { high: "#f38ba8", medium: "#f9e2af", low: accent };
  const dotColor = urgencyColors[urgency] || accent;
  const effectiveRailDotColor = railDotColor || dotColor;
  const isSpecialDateEvent = item.kind === "event" && isGoogleSpecialDateEvent(item.data);
  const opacity = isPast ? 0.38 : 1;
  const railBorderColor = railDotColor
    ? `${effectiveRailDotColor}${isLive ? "" : "55"}`
    : isLive
      ? effectiveRailDotColor
      : "rgba(255,255,255,0.15)";
  const railGlow = isLive
    ? `0 0 10px ${effectiveRailDotColor}80`
    : railDotColor
      ? `0 0 0 1px ${effectiveRailDotColor}18`
      : "none";
  const timeColumnWidth = isMobile ? 52 : 54;

  return (
    <div
      data-testid={isMobile ? "timeline-row-mobile" : "timeline-row-desktop"}
      role="button"
      tabIndex={0}
      onClick={(e) => onJump?.(jumpPayload, e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onJump?.(jumpPayload, e.currentTarget);
      }}
      style={{
        position: "relative",
        overflow: isLive ? "hidden" : "visible",
        padding: isMobile ? "10px 10px 10px 22px" : "11px 12px",
        marginBottom: 4,
        borderRadius: 10,
        cursor: "pointer",
        opacity,
        border: isLive ? `1px solid ${accent}24` : "1px solid transparent",
        transition: "transform 180ms ease, background 130ms ease, border-color 130ms ease",
        display: "grid",
        gridTemplateColumns: isMobile ? `${timeColumnWidth}px minmax(0, 1fr)` : `${timeColumnWidth}px 1fr auto`,
        gap: isMobile ? 10 : 14,
        alignItems: isMobile ? "start" : "center",
        background: isLive ? `${accent}08` : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!isLive) {
          e.currentTarget.style.background = "rgba(255,255,255,0.024)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)";
          e.currentTarget.style.transform = "translateX(2px)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isLive) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.borderColor = "transparent";
          e.currentTarget.style.transform = "translateX(0)";
        }
      }}
    >
      <div
        data-testid="timeline-row-dot"
        style={{
          position: "absolute",
          left: isMobile ? -30 : -22,
          top: isMobile ? 13 : 14,
          width: 13,
          height: 13,
          borderRadius: 99,
          background: "var(--sp-deep)",
          display: "grid",
          placeItems: "center",
          border: `1px solid ${railBorderColor}`,
          boxShadow: railGlow,
        }}
      >
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: 99,
            background: effectiveRailDotColor,
            ...(isLive ? { animation: "dashPulse 2s ease-in-out infinite" } : {}),
          }}
        />
      </div>

      <div
        style={{
          fontSize: isMobile ? 10.5 : 11.5,
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          color: isLive ? dotColor : "rgba(205,214,244,0.7)",
          letterSpacing: 0.2,
          paddingTop: isMobile ? 1 : 0,
        }}
      >
        {leftLabel}
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: isMobile ? "flex-start" : "center",
            flexWrap: isMobile ? "wrap" : "nowrap",
            gap: 8,
            marginBottom: 2,
          }}
        >
          {isSpecialDateEvent ? (
            <GoogleSpecialDateBadge
              item={item.data}
              color={effectiveRailDotColor}
              variant="chip"
            />
          ) : Icon ? (
            <Icon size={isMobile ? 10 : 11} color={iconColor || "rgba(205,214,244,0.55)"} />
          ) : null}
          <div
            data-dashboard-timeline-title="true"
            style={{
              fontSize: isMobile ? 12.5 : 13,
              fontWeight: 500,
              color: "var(--sp-text)",
              overflow: "hidden",
              textOverflow: isSpecialDateEvent ? "clip" : "ellipsis",
              whiteSpace: isMobile || isSpecialDateEvent ? "normal" : "nowrap",
              lineHeight: isMobile || isSpecialDateEvent ? 1.32 : "normal",
              display: isSpecialDateEvent ? "-webkit-box" : "block",
              WebkitLineClamp: isSpecialDateEvent ? 2 : undefined,
              WebkitBoxOrient: isSpecialDateEvent ? "vertical" : undefined,
              flex: 1,
              minWidth: 0,
              textDecoration: isPast ? "line-through" : "none",
              textDecorationColor: "rgba(205,214,244,0.25)",
            }}
          >
            {title}
          </div>
          {isLive && (
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 99,
                fontSize: 9,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                fontWeight: 600,
                background: `${dotColor}20`,
                color: dotColor,
              }}
            >
              Live now
            </span>
          )}
          {priorityLevel && <PriorityFlag level={priorityLevel} />}
          {overdueText && (
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 99,
                fontSize: 9,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                fontWeight: 600,
                background: "color-mix(in srgb, var(--sp-rose) 13%, transparent)",
                color: "var(--sp-rose)",
                whiteSpace: "nowrap",
              }}
            >
              {overdueText}
            </span>
          )}
          {reminderSummary && (
            <span
              data-testid="dashboard-reminder-indicator"
              aria-label={reminderSummary}
              title={reminderSummary}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                maxWidth: isMobile ? "100%" : 170,
                padding: "2px 6px",
                borderRadius: 999,
                border: "1px solid color-mix(in srgb, var(--sp-cream) 28%, transparent)",
                background: "color-mix(in srgb, var(--sp-cream) 10%, transparent)",
                color: "var(--sp-cream)",
                fontSize: isMobile ? 9.5 : 10,
                fontWeight: 650,
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              <Bell size={isMobile ? 10 : 11} aria-hidden />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {reminderSummary}
              </span>
            </span>
          )}
        </div>
        {sub && (
          <div
            style={{
              fontSize: isMobile ? 10.5 : 11,
              color: "var(--color-text-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: isMobile ? "normal" : "nowrap",
              lineHeight: isMobile ? 1.35 : "normal",
            }}
          >
            {sub}
          </div>
        )}
        {isMobile && meta && (
          <div
            style={{
              marginTop: 6,
              display: "inline-flex",
              maxWidth: "100%",
              fontSize: isMobile ? 10 : 10.5,
              color: "var(--color-text-faint)",
              fontVariantNumeric: "tabular-nums",
              padding: "2px 8px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            {meta}
          </div>
        )}
      </div>

      {!isMobile && meta && (
        <div
          style={{
            fontSize: 10.5,
            color: "var(--color-text-faint)",
            fontVariantNumeric: "tabular-nums",
            padding: "2px 8px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.03)",
          }}
        >
          {meta}
        </div>
      )}
      {liveMarker && (() => {
        const pctStr = `${liveMarker.pct * 100}%`;
        return (
          <div data-testid="timeline-now-marker" style={{ gridColumn: "1 / -1", position: "relative", height: 22, marginTop: 8, borderTop: `1px solid ${accent}2e`, pointerEvents: "none" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pctStr, background: `linear-gradient(90deg, ${accent}29, ${accent}0d)` }} />
            <div style={{ position: "absolute", left: pctStr, top: 0, bottom: 0, width: 1.5, background: accent, boxShadow: `0 0 8px ${accent}` }} />
            <div style={{ position: "absolute", left: pctStr, top: "50%", transform: "translate(8px, -50%)", fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 700, color: accent, whiteSpace: "nowrap" }}>
              {liveMarker.label}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default memo(TimelineRow);
