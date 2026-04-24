import {
  Calendar,
  CheckCircle2,
  Circle,
  CircleDashed,
  Coffee,
  Flag,
  Plane,
  Users,
  Video,
} from "lucide-react";
import {
  eventState,
  formatEventDuration,
  formatEventTime,
  getEventSelectionId,
  overdueLabel,
  urgencyForDays,
} from "../../../lib/redesign-helpers";
import { daysUntil } from "../../../lib/bill-utils";
import {
  DEADLINE_SOURCE_COLORS,
  PRIORITY_COLOR,
} from "./timeline-helpers";

function PriorityFlag({ level, size = 11 }) {
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

export default function TimelineRow({ accent, isMobile = false, item, now, onJump }) {
  let Icon;
  let iconColor;
  let title;
  let sub;
  let meta;
  let leftLabel;
  let urgency;
  let jumpPayload;
  let isPast = false;
  let isLive = false;
  let priorityLevel = null;
  let overdueText = null;
  let railDotColor = null;

  if (item.kind === "event") {
    const event = item.data;
    const state = eventState(event, now);
    isPast = state === "past";
    isLive = state === "live";
    Icon = /zoom|video/i.test(event.location || "") || event.hangoutLink ? Video
      : /flight|airport|plane/i.test(event.title || "") ? Plane
      : /coffee|lunch|dinner/i.test(event.title || "") ? Coffee
      : event.attendees?.length > 1 ? Users
      : Calendar;
    leftLabel = formatEventTime(event.startMs);
    title = event.title;
    sub = event.attendees?.length
      ? `with ${event.attendees.slice(0, 3).join(", ")}${event.attendees.length > 3 ? ` +${event.attendees.length - 3}` : ""}`
      : event.location || event.subtitle;
    meta = formatEventDuration(event.startMs, event.endMs);
    urgency = isLive ? "high" : "low";
    railDotColor = event.color || event.sourceColor || accent;
    jumpPayload = { kind: "event", id: getEventSelectionId(event), data: event };
  } else if (item.kind === "deadline") {
    const deadline = item.data;
    const days = daysUntil(deadline.due_date);
    urgency = urgencyForDays(days, accent).key;
    isPast = deadline.status === "complete";
    Icon = deadline.status === "complete" ? CheckCircle2
      : deadline.status === "in_progress" ? CircleDashed
      : Circle;
    iconColor = deadline.status === "complete" ? "#a6e3a1"
      : deadline.status === "in_progress" ? "#89dceb"
      : "rgba(205,214,244,0.55)";
    leftLabel = deadline.due_time || "11:59p";
    title = deadline.title;
    sub = deadline.class_name || deadline.source || "";
    meta = deadline.source === "todoist" ? "Todoist" : deadline.source === "canvas" ? "Canvas" : "CTM";
    if (deadline.source === "todoist" && PRIORITY_COLOR[deadline.priority]) {
      priorityLevel = deadline.priority;
    }
    if (deadline.source === "todoist" && deadline.status !== "complete") {
      overdueText = overdueLabel(item.dueAtMs, now);
    }
    railDotColor = DEADLINE_SOURCE_COLORS[deadline.source] || DEADLINE_SOURCE_COLORS.canvas;
    jumpPayload = { kind: "deadline", id: deadline.id, data: deadline };
  } else {
    return null;
  }

  const urgencyColors = { high: "#f38ba8", medium: "#f9e2af", low: accent };
  const dotColor = urgencyColors[urgency] || accent;
  const effectiveRailDotColor = railDotColor || dotColor;
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
          background: "#0b0b13",
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
          <Icon size={isMobile ? 10 : 11} color={iconColor || "rgba(205,214,244,0.55)"} />
          <div
            style={{
              fontSize: isMobile ? 12.5 : 13,
              fontWeight: 500,
              color: "#cdd6f4",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: isMobile ? "normal" : "nowrap",
              lineHeight: isMobile ? 1.35 : "normal",
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
              Live
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
                background: "#f38ba820",
                color: "#f38ba8",
                whiteSpace: "nowrap",
              }}
            >
              {overdueText}
            </span>
          )}
        </div>
        {sub && (
          <div
            style={{
              fontSize: isMobile ? 10.5 : 11,
              color: "rgba(205,214,244,0.45)",
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
              color: "rgba(205,214,244,0.5)",
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
            color: "rgba(205,214,244,0.5)",
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
  );
}
