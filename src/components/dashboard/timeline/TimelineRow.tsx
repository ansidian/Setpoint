import { memo } from "react";
import "./timeline-mobile.css";
import "./timeline-presentation.css";
import {
  Calendar,
  ClockAlert,
  Bell,
  CheckCircle2,
  Circle,
  CircleDashed,
  Coffee,
  Flag,
  ArrowUp,
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
  isNeedsYouReference?: boolean;
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
  isNeedsYouReference = false,
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
  const showNeedsYouReference = isNeedsYouReference && item.kind === "deadline";
  const secondaryColor = isPast ? "var(--color-text-faint)" : "var(--color-text-secondary, #a6adc8)";
  const titleColor = isPast ? "var(--color-text-faint)" : "var(--sp-text)";
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
  const timeColumnWidth = 68;
  const status = item.kind === "event"
    ? null
    : item.data.status === "complete" ? { label: "Completed", tone: "completed", Icon: CheckCircle2 }
    : overdueText ? { label: overdueText, tone: "overdue", Icon: ClockAlert } : null;

  return (
    <div
      data-testid={isMobile ? "timeline-row-mobile" : "timeline-row-desktop"}
      data-needs-you-reference={showNeedsYouReference ? "true" : undefined}
      className={`${isPast ? "timeline-row--past " : ""}${isMobile ? "timeline-mobile-row " : ""}dashboard-item-trigger sp-focus-ring`}
      role="button"
      tabIndex={0}
      onClick={(e) => onJump?.(jumpPayload, e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onJump?.(jumpPayload, e.currentTarget);
        }
      }}
      style={{
        position: "relative",
        overflow: "visible",
        padding: showNeedsYouReference ? "10px" : "12px 10px",
        marginBottom: 2,
        borderRadius: 8,
        cursor: "pointer",
        border: isLive ? `1px solid ${accent}24` : "1px solid transparent",
        transition: "transform 150ms cubic-bezier(0.22, 1, 0.36, 1), background 150ms ease, border-color 150ms ease",
        display: "grid",
        gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : showNeedsYouReference ? `${timeColumnWidth}px minmax(0, 1fr)` : `${timeColumnWidth}px 1fr auto`,
        gap: isMobile ? 8 : 12,
        alignItems: isMobile ? "start" : "center",
        background: isLive ? `${accent}08` : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!isMobile) {
          e.currentTarget.style.background = isLive ? `${accent}10` : "rgba(255,255,255,0.024)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isMobile) {
          e.currentTarget.style.background = isLive ? `${accent}08` : "transparent";
          e.currentTarget.style.borderColor = isLive ? `${accent}24` : "transparent";
        }
      }}
    >
      <div
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
          opacity: isPast ? 0.45 : 1,
        }}
      >
        <div
          data-testid="timeline-row-dot"
          style={{
            width: 5,
            height: 5,
            borderRadius: 99,
            background: effectiveRailDotColor,
            ...(isLive ? { animation: "dashPulse 2s ease-in-out infinite" } : {}),
          }}
        />
      </div>

      {!isMobile && <div
        style={{
          fontSize: 11.5,
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          color: isLive ? effectiveRailDotColor : secondaryColor,
          letterSpacing: 0,
          whiteSpace: "nowrap",
          paddingTop: isMobile ? 1 : 0,
        }}
      >
        {leftLabel}
      </div>}

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: isMobile && !showNeedsYouReference ? "wrap" : "nowrap",
            gap: 8,
            marginBottom: showNeedsYouReference ? 0 : 2,
          }}
        >
          {isMobile && leftLabel && (
            <span style={{ fontSize: 11.5, color: secondaryColor, fontVariantNumeric: "tabular-nums" }}>{leftLabel}</span>
          )}
          {isMobile && meta && !showNeedsYouReference && (
            <span style={{ fontSize: 11, color: secondaryColor }}>{meta}</span>
          )}
          {!showNeedsYouReference && (isSpecialDateEvent ? (
            <GoogleSpecialDateBadge
              item={item.data}
              color={effectiveRailDotColor}
              variant="chip"
            />
          ) : Icon ? (
            <Icon size={isMobile ? 10 : 11} color={isPast ? "var(--color-text-faint)" : iconColor || "rgba(205,214,244,0.55)"} />
          ) : null)}
          <div
            data-dashboard-timeline-title="true"
            style={{
              fontSize: showNeedsYouReference ? (isMobile ? 12.5 : 12) : isMobile ? 14 : 13,
              fontWeight: 500,
              color: titleColor,
              overflow: "hidden",
              textOverflow: isSpecialDateEvent ? "clip" : "ellipsis",
              whiteSpace: isMobile || isSpecialDateEvent ? "normal" : "nowrap",
              lineHeight: showNeedsYouReference ? 1.3 : isMobile || isSpecialDateEvent ? 1.32 : "normal",
              display: isSpecialDateEvent || (isMobile && showNeedsYouReference) ? "-webkit-box" : "block",
              WebkitLineClamp: isSpecialDateEvent || (isMobile && showNeedsYouReference) ? 2 : undefined,
              WebkitBoxOrient: isSpecialDateEvent || (isMobile && showNeedsYouReference) ? "vertical" : undefined,
              flex: showNeedsYouReference ? 1 : isMobile ? "0 0 100%" : 1,
              order: isMobile && !showNeedsYouReference ? -1 : undefined,
              overflowWrap: isMobile && !showNeedsYouReference ? "anywhere" : undefined,
              minWidth: 0,
              textDecorationLine: item.kind === "deadline" && item.data.status === "complete" ? "line-through" : "none",
              textDecorationColor: "rgba(205,214,244,0.25)",
            }}
          >
            {title}
          </div>
          {showNeedsYouReference && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                flex: "none",
                color: accent,
                fontSize: 10,
                fontWeight: 650,
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              <ArrowUp size={10} strokeWidth={2.2} aria-hidden="true" />
              Needs You
            </span>
          )}
          {isLive && (
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 99,
                fontSize: 9,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                fontWeight: 600,
                background: `${effectiveRailDotColor}18`,
                color: effectiveRailDotColor,
              }}
            >
              Live now
            </span>
          )}
          {!showNeedsYouReference && priorityLevel && <PriorityFlag level={priorityLevel} />}
          {!showNeedsYouReference && reminderSummary && (
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
        {(status || (sub && !showNeedsYouReference)) && (
          <div className="timeline-row-metadata">
            {status && <span className={`timeline-row-status timeline-row-status--${status.tone}`}>
              <status.Icon size={11} aria-hidden="true" />{status.label}
            </span>}
            {sub && !showNeedsYouReference && <span className="timeline-row-description">{sub}</span>}
          </div>
        )}
      </div>

      {!isMobile && meta && !showNeedsYouReference && (
        <div
          style={{
            fontSize: 10.5,
            color: secondaryColor,
            fontVariantNumeric: "tabular-nums",
            padding: "2px 8px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.03)",
            alignSelf: item.kind === "deadline" ? "start" : undefined,
          }}
        >
          {meta}
        </div>
      )}
      {liveMarker && (() => {
        const pctStr = `${liveMarker.pct * 100}%`;
        return (
          <div data-testid="timeline-now-marker" className="timeline-progress">
            <div className="timeline-progress-track"><span className="timeline-progress-fill" style={{ width: pctStr, background: effectiveRailDotColor }} /></div>
            <span className="timeline-progress-label">{liveMarker.label}</span>
          </div>
        );
      })()}
    </div>
  );
}

export default memo(TimelineRow);
