import { useEffect, useMemo, useReducer, useState } from "react";
import {
  Sparkles, AlertCircle, CreditCard, ArrowRight, Inbox,
  Circle, CircleDashed, CheckCircle2, Check, Flag,
} from "lucide-react";
import { daysUntil, formatAmount } from "../../../lib/bill-utils";
import { daysLabel, urgencyForDays, deriveLane } from "../../../lib/redesign-helpers";
import { formatFullDate } from "../../../lib/dashboard-helpers";
import { resolveInsight } from "../../../lib/insight-resolver";
import { Icon } from "@/lib/icons.jsx";
import { Skeleton } from "@/components/ui/skeleton";
import Tooltip from "../../shared/Tooltip";

function SectionHeader({ title, subtitle, right, isMobile = false }) {
  return (
    <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "flex-end", justifyContent: "space-between", gap: 10, flexWrap: isMobile ? "wrap" : "nowrap" }}>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 10, fontWeight: 600, letterSpacing: 2.2, textTransform: "uppercase",
            color: "rgba(205,214,244,0.55)",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: "rgba(205,214,244,0.4)", marginTop: 3 }}>{subtitle}</div>
        )}
      </div>
      {right}
    </div>
  );
}

function verboseDaysLabel(days) {
  if (days == null || Number.isNaN(days)) return "No due date";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) {
    const count = Math.abs(days);
    return `${count} ${count === 1 ? "day" : "days"} overdue`;
  }
  return `In ${days} days`;
}

function UrgencyPill({ days, accent, compact, verbose = false }) {
  const u = urgencyForDays(days, accent).key;
  const color = u === "high" ? "#f38ba8" : u === "medium" ? "#f9e2af" : accent;
  return (
    <div
      style={{
        fontSize: compact ? 9.5 : 10, fontWeight: 600,
        padding: "2px 7px", borderRadius: 99,
        background: `${color}22`, color, letterSpacing: 0.2,
        fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
      }}
    >
      {verbose ? verboseDaysLabel(days) : daysLabel(days)}
    </div>
  );
}

function OpenInboxButton({ accent, onClick }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const active = hover || focus;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        padding: "3px 8px",
        borderRadius: 6,
        border: `1px solid ${active ? `${accent}3f` : "rgba(255,255,255,0.08)"}`,
        background: active ? `${accent}14` : "rgba(255,255,255,0.015)",
        color: active ? accent : "rgba(205,214,244,0.7)",
        fontSize: 10,
        fontFamily: "inherit",
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
      }}
    >
      <span>Open</span>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          transform: active ? "translateX(1.5px)" : "translateX(0)",
          transition: "transform 140ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <ArrowRight size={9} />
      </span>
    </button>
  );
}

function DeadlineStatusIcon({ status, size = 12 }) {
  if (status === "complete") return <CheckCircle2 size={size} color="#a6e3a1" />;
  if (status === "in_progress") return <CircleDashed size={size} color="#89dceb" />;
  return <Circle size={size} color="rgba(205,214,244,0.45)" />;
}

// Todoist priority levels: 1 = urgent, 2 = high, 3 = medium, 4 = low (default).
// We only surface 1–3 since "no flag" is the expected baseline and rendering
// every P4 badge would add visual noise without adding information.
const PRIORITY_COLOR = {
  1: "#f38ba8",
  2: "#f9e2af",
  3: "#89b4fa",
};

function PriorityFlag({ level, size = 11 }) {
  const color = PRIORITY_COLOR[level];
  if (!color) return null;
  return (
    <span
      title={`P${level}`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: size + 4, height: size + 4, borderRadius: 4,
        background: `${color}1e`, border: `1px solid ${color}38`,
        flexShrink: 0,
      }}
    >
      <Flag size={size - 2} color={color} strokeWidth={2.2} />
    </span>
  );
}

function CountBadge({ n }) {
  return (
    <div
      style={{
        fontSize: 10, fontWeight: 500, padding: "1px 7px", borderRadius: 99,
        background: "rgba(255,255,255,0.05)", color: "rgba(205,214,244,0.6)",
      }}
    >
      {n}
    </div>
  );
}

function RailGroupLabel({ label, count, tone = "default" }) {
  const color = tone === "success" ? "#a6e3a1" : "rgba(205,214,244,0.58)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 6,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "rgba(205,214,244,0.38)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </div>
    </div>
  );
}

const AI_GRADIENT = "linear-gradient(120deg, #c88fa0 0%, #c89b85 25%, #8fb8c8 55%, #a89bc4 80%, #c88fa0 100%)";

export function InsightsRail({ accent, insights = [], onJump, isMobile = false, maxItems = 5 }) {
  const [, forceTick] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(forceTick, 60_000);
    return () => clearInterval(id);
  }, []);
  const now = new Date();
  const visibleInsights = insights.slice(0, maxItems);

  return (
    <div data-sect="insights">
      <SectionHeader
        title="AI noticed"
        subtitle={isMobile ? "One quick pattern worth surfacing" : "Pattern-level signal across your data"}
        isMobile={isMobile}
      />
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: isMobile ? 6 : 8 }}>
        {visibleInsights.map((ins, i) => (
          <InsightRow
            key={ins.id || i}
            insight={ins}
            accent={accent}
            onJump={onJump}
            now={now}
            featured={!isMobile && i === 0}
            isMobile={isMobile}
          />
        ))}
        {visibleInsights.length === 0 && (
          <div
            style={{
              padding: isMobile ? "14px 12px" : "16px 14px", borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.05)",
              fontSize: isMobile ? 11 : 11.5, color: "rgba(205,214,244,0.5)", lineHeight: 1.5,
            }}
          >
            No AI insights yet — run a fresh briefing to see what Claude notices.
          </div>
        )}
      </div>
    </div>
  );
}

function InsightRow({ insight, accent, onJump, now, featured, isMobile = false }) {
  const [hovered, setHovered] = useState(false);
  const text = resolveInsight(insight, now);
  if (!text) return null;

  const handlers = {
    role: "button",
    tabIndex: 0,
    onClick: () => onJump?.({ kind: "insight", insight }),
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") onJump?.({ kind: "insight", insight }); },
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };

  const innerBg = hovered ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)";

  if (featured) {
    // Wrap the row in a gradient "outline" — padding:1 creates a 1px band from
    // the same animated gradient used by the "Extract with Haiku" button.
    // The inner div needs an opaque fill so the gradient only shows in that
    // 1px edge (translucent fills let it bleed through the whole card). We
    // stack an opaque dark base matched to the dashboard's radial backdrop,
    // then layer the usual translucent card tint on top so the card still
    // brightens on hover like its neighbours.
    // Use a linear-gradient() to express the translucent tint as an image
    // layer — CSS only allows a raw color in the final layer of the shorthand.
    const featuredInner = `linear-gradient(${innerBg}, ${innerBg}), #121220`;
    return (
      <div
        {...handlers}
        style={{
          borderRadius: 10,
          background: AI_GRADIENT,
          backgroundSize: "240% 100%",
          animation: "aiGradientShift 7s ease-in-out infinite",
          padding: 1,
          cursor: "pointer", position: "relative",
        }}
      >
        <div
          style={{
            padding: "12px 14px", borderRadius: 9,
            background: featuredInner,
            display: "flex", alignItems: "flex-start", gap: 10,
            transition: "background 130ms",
          }}
        >
          <InsightRowContent accent={accent} insight={insight} text={text} />
        </div>
      </div>
    );
  }

  return (
    <div
      {...handlers}
      style={{
        padding: isMobile ? "10px 12px" : "12px 14px", borderRadius: 10,
        background: innerBg,
        border: hovered ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.05)",
        cursor: "pointer", position: "relative",
        transition: "all 130ms",
        display: "flex", alignItems: "flex-start", gap: 10,
      }}
    >
      <InsightRowContent accent={accent} insight={insight} text={text} isMobile={isMobile} />
    </div>
  );
}

function InsightRowContent({ accent, insight, text, isMobile = false }) {
  return (
    <>
      <div
        style={{
          width: isMobile ? 20 : 22, height: isMobile ? 20 : 22, borderRadius: 6, flexShrink: 0,
          background: `${accent}14`, display: "grid", placeItems: "center",
          marginTop: 1,
        }}
      >
        <Icon name={insight.icon || "Sparkles"} size={isMobile ? 10 : 11} color={accent} />
      </div>
      <div
        style={{
          fontSize: isMobile ? 11.5 : 12, color: "rgba(205,214,244,0.85)",
          lineHeight: 1.5, textWrap: "pretty", minWidth: 0,
        }}
      >
        {text}
      </div>
    </>
  );
}

export function DeadlinesRail({ accent, deadlines = [], onJump, isMobile = false }) {
  // Keep completed deadlines visible (strikethrough) only while the day isn't
  // past — once today has rolled past their due date they belong on the
  // calendar (which has its own visibility window), not on the dashboard.
  const grouped = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const visible = [...deadlines]
      .filter((d) => !(d.status === "complete" && d.due_date && d.due_date < today))
      .map((d) => ({ d, days: daysUntil(d.due_date) }))
      .sort((a, b) => {
        const aDone = a.d.status === "complete" ? 1 : 0;
        const bDone = b.d.status === "complete" ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        if (a.days == null) return 1;
        if (b.days == null) return -1;
        return a.days - b.days;
      });

    const open = visible.filter(({ d }) => d.status !== "complete").slice(0, 4);
    const completed = visible.filter(({ d }) => d.status === "complete").slice(0, 2);
    return { open, completed };
  }, [deadlines]);

  const openCount = deadlines.filter((d) => d.status !== "complete").length;

  return (
    <div data-sect="deadlines">
      <SectionHeader
        title="Deadlines"
        isMobile={isMobile}
        right={<CountBadge n={openCount} />}
      />
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column" }}>
        {grouped.open.length > 0 && (
          <div>
            <RailGroupLabel label="Open" count={grouped.open.length} />
            {grouped.open.map(({ d, days }) => {
              const isTodoist = d.source === "todoist";
              const showPriority = isTodoist && PRIORITY_COLOR[d.priority];
              return (
                <div
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) =>
                    onJump?.(
                      { kind: "deadline", id: d.id, data: d },
                      e.currentTarget,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ")
                      onJump?.(
                        { kind: "deadline", id: d.id, data: d },
                        e.currentTarget,
                      );
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "16px minmax(0, 1fr)"
                      : showPriority
                        ? "16px 1fr auto auto"
                        : "16px 1fr auto",
                    gap: 10,
                    alignItems: isMobile ? "start" : "center",
                    padding: isMobile ? "10px 2px" : "9px 2px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    cursor: "pointer",
                    transition: "background 150ms",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <DeadlineStatusIcon status={d.status} />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#cdd6f4",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: isMobile ? "normal" : "nowrap",
                        marginBottom: 2,
                      }}
                    >
                      {d.title}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: "rgba(205,214,244,0.45)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: isMobile ? "normal" : "nowrap",
                      }}
                    >
                      {d.class_name || d.source}
                    </div>
                    {isMobile && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          marginTop: 6,
                        }}
                      >
                        {showPriority && <PriorityFlag level={d.priority} />}
                        <Tooltip
                          text={formatFullDate(d.due_date)}
                          sideOffset={12}
                          side="right"
                        >
                          <UrgencyPill days={days} accent={accent} verbose />
                        </Tooltip>
                      </div>
                    )}
                  </div>
                  {!isMobile && showPriority && (
                    <PriorityFlag level={d.priority} />
                  )}
                  {!isMobile && (
                    <Tooltip
                      text={formatFullDate(d.due_date)}
                      side="right"
                      sideOffset={12}
                      collisionAvoidance={{ side: "shift" }}
                    >
                      <UrgencyPill days={days} accent={accent} verbose />
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {grouped.completed.length > 0 && (
          <div style={{ marginTop: grouped.open.length > 0 ? 12 : 0 }}>
            <RailGroupLabel label="Completed" count={grouped.completed.length} tone="success" />
            {grouped.completed.map(({ d, days }) => {
              const isTodoist = d.source === "todoist";
              const showPriority = isTodoist && PRIORITY_COLOR[d.priority];
              return (
                <div
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) =>
                    onJump?.(
                      { kind: "deadline", id: d.id, data: d },
                      e.currentTarget,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ")
                      onJump?.(
                        { kind: "deadline", id: d.id, data: d },
                        e.currentTarget,
                      );
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "16px minmax(0, 1fr)"
                      : showPriority
                        ? "16px 1fr auto auto"
                        : "16px 1fr auto",
                    gap: 10,
                    alignItems: isMobile ? "start" : "center",
                    padding: isMobile ? "10px 2px" : "9px 2px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    cursor: "pointer",
                    transition: "background 150ms",
                    opacity: 0.55,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <DeadlineStatusIcon status={d.status} />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#cdd6f4",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: isMobile ? "normal" : "nowrap",
                        marginBottom: 2,
                        textDecoration: "line-through",
                        textDecorationColor: "rgba(205,214,244,0.35)",
                      }}
                    >
                      {d.title}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: "rgba(205,214,244,0.45)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: isMobile ? "normal" : "nowrap",
                      }}
                    >
                      {d.class_name || d.source}
                    </div>
                    {isMobile && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          marginTop: 6,
                        }}
                      >
                        {showPriority && <PriorityFlag level={d.priority} />}
                        <Tooltip
                          text={formatFullDate(d.due_date)}
                          sideOffset={12}
                        >
                          <UrgencyPill days={days} accent={accent} verbose />
                        </Tooltip>
                      </div>
                    )}
                  </div>
                  {!isMobile && showPriority && (
                    <PriorityFlag level={d.priority} />
                  )}
                  {!isMobile && (
                    <Tooltip
                      text={formatFullDate(d.due_date)}
                      side="right"
                      sideOffset={12}
                      collisionAvoidance={{ side: "shift" }}
                    >
                      <UrgencyPill days={days} accent={accent} verbose />
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {grouped.open.length === 0 && grouped.completed.length === 0 && (
          <EmptyRow icon={AlertCircle} label="No deadlines" />
        )}
      </div>
    </div>
  );
}

function PaidChip() {
  return (
    <div
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        fontSize: 9.5, fontWeight: 600,
        padding: "2px 7px", borderRadius: 99,
        background: "rgba(166,227,161,0.14)",
        color: "#a6e3a1", letterSpacing: 0.2,
        whiteSpace: "nowrap",
      }}
    >
      <Check size={9} strokeWidth={3} />
      Paid
    </div>
  );
}

const MAX_VISIBLE_BILLS = 5;
const BILL_ROW_MIN_HEIGHT = 51;
const BILL_ROW_MIN_HEIGHT_MOBILE = 72;

function BillsRailLoadingPlaceholder({ isMobile = false }) {
  return (
    <div
      data-testid="bills-rail-loading-placeholder"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        paddingTop: 2,
      }}
    >
      {Array.from({ length: MAX_VISIBLE_BILLS }).map((_, index) => (
        <div
          key={index}
          style={{
            minHeight: isMobile ? BILL_ROW_MIN_HEIGHT_MOBILE : BILL_ROW_MIN_HEIGHT,
            padding: isMobile ? "10px 2px" : "9px 2px",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            display: "grid",
            gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "1fr auto",
            gap: 10,
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            <Skeleton className="h-[12px] w-[52%] bg-white/10" />
            <Skeleton className="h-[10px] w-[36%] bg-white/7" />
          </div>
          {!isMobile && <Skeleton className="h-[18px] w-[64px] bg-white/8" />}
        </div>
      ))}
    </div>
  );
}

export function BillsRail({ accent, bills = [], onJump, isMobile = false, loadingState = "ready" }) {
  // Show paid AND unpaid upcoming bills. Drop bills whose due date is strictly
  // in the past (days < 0) — once overdue, they belong on the calendar's
  // history, not the dashboard. Paid bills that are still upcoming remain
  // visible with a "Paid" indicator so the user knows they're handled.
  const upcoming = useMemo(() => {
    return [...bills]
      .map((b) => ({ b, days: daysUntil(b.next_date) }))
      .filter((x) => x.days == null ? false : x.days >= 0)
      .sort((a, b) => {
        // Unpaid first within each day bucket so action items surface.
        if (a.days !== b.days) return a.days - b.days;
        const ap = a.b.paid ? 1 : 0;
        const bp = b.b.paid ? 1 : 0;
        return ap - bp;
      })
      .slice(0, 5);
  }, [bills]);

  const nextWeekTotal = upcoming
    .filter((x) => x.days != null && x.days <= 7 && !x.b.paid)
    .reduce((s, x) => s + (x.b.amount || 0), 0);
  const showLoadingPlaceholder = loadingState === "empty_loading";
  const reservedListMinHeight = (isMobile ? BILL_ROW_MIN_HEIGHT_MOBILE : BILL_ROW_MIN_HEIGHT) * MAX_VISIBLE_BILLS;

  return (
    <div data-sect="bills">
      <SectionHeader
        title="Bills"
        isMobile={isMobile}
        right={
          showLoadingPlaceholder ? (
            <div
              data-testid="bills-rail-refresh-status"
              style={{ fontSize: 10, color: "rgba(205,214,244,0.46)" }}
            >
              Loading Actual...
            </div>
          ) : (
            <div style={{ fontSize: 10, color: "rgba(205,214,244,0.5)" }}>
              Next 7d ·{" "}
              <span style={{ color: "#cdd6f4", fontWeight: 600 }}>{formatAmount(nextWeekTotal)}</span>
            </div>
          )
        }
      />
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          minHeight: showLoadingPlaceholder || upcoming.length > 0 ? reservedListMinHeight : undefined,
        }}
      >
        {showLoadingPlaceholder ? <BillsRailLoadingPlaceholder isMobile={isMobile} /> : null}
        {upcoming.map(({ b, days }) => {
          const paid = !!b.paid;
          return (
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              onClick={(e) =>
                onJump?.({ kind: "bill", id: b.id, data: b }, e.currentTarget)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  onJump?.(
                    { kind: "bill", id: b.id, data: b },
                    e.currentTarget,
                  );
              }}
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "minmax(0, 1fr)"
                  : "1fr auto auto",
                gap: 10,
                alignItems: isMobile ? "start" : "center",
                minHeight: isMobile ? BILL_ROW_MIN_HEIGHT_MOBILE : BILL_ROW_MIN_HEIGHT,
                padding: isMobile ? "10px 2px" : "9px 2px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                transition: "background 150ms",
                opacity: paid ? 0.72 : 1,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.02)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "#cdd6f4",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration: paid ? "line-through" : "none",
                    textDecorationColor: "rgba(205,214,244,0.35)",
                  }}
                >
                  {b.name}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "rgba(205,214,244,0.45)",
                    marginTop: 2,
                  }}
                >
                  {b.payee || ""}
                </div>
                {isMobile && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: 500,
                        color: paid ? "#a6e3a1" : "#cdd6f4",
                        fontVariantNumeric: "tabular-nums",
                        textDecoration: paid ? "line-through" : "none",
                        textDecorationColor: paid
                          ? "rgba(166,227,161,0.5)"
                          : "transparent",
                      }}
                    >
                      {formatAmount(b.amount)}
                    </div>
                    {paid ? (
                      <PaidChip />
                    ) : (
                      <Tooltip
                        text={formatFullDate(b.next_date)}
                        side="right"
                        sideOffset={12}
                        collisionAvoidance={{ side: "shift" }}
                      >
                        <UrgencyPill
                          days={days}
                          accent={accent}
                          compact
                          verbose
                        />
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>
              {!isMobile && (
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: paid ? "#a6e3a1" : "#cdd6f4",
                    fontVariantNumeric: "tabular-nums",
                    textDecoration: paid ? "line-through" : "none",
                    textDecorationColor: paid
                      ? "rgba(166,227,161,0.5)"
                      : "transparent",
                  }}
                >
                  {formatAmount(b.amount)}
                </div>
              )}
              {!isMobile &&
                (paid ? (
                  <PaidChip />
                ) : (
                  <Tooltip
                    text={formatFullDate(b.next_date)}
                    side="right"
                    sideOffset={12}
                    collisionAvoidance={{ side: "shift" }}
                  >
                    <UrgencyPill days={days} accent={accent} compact verbose />
                  </Tooltip>
                ))}
            </div>
          );
        })}
        {upcoming.length === 0 && !showLoadingPlaceholder && <EmptyRow icon={CreditCard} label="No upcoming bills" />}
      </div>
    </div>
  );
}

export function InboxPeek({ accent = "#cba6da", emailAccounts = [], onJump, onOpenInbox, isMobile = false }) {
  const flat = useMemo(() => {
    const all = [];
    for (const acc of emailAccounts) {
      for (const e of acc.important || []) {
        all.push({ ...e, _account: acc, _lane: deriveLane(e) });
      }
    }
    return all
      .sort((a, b) => (a.read === b.read ? new Date(b.date) - new Date(a.date) : (a.read ? 1 : 0) - (b.read ? 1 : 0)))
      .slice(0, 5);
  }, [emailAccounts]);

  const needsYou = flat.filter((e) => e._lane === "action" && !e.read).length;

  return (
    <div data-sect="inbox-peek">
      <SectionHeader
        title="Inbox peek"
        isMobile={isMobile}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {needsYou > 0 && (
              <span
                style={{
                  fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 99,
                  background: "rgba(243,139,168,0.15)", color: "#f38ba8",
                }}
              >
                {needsYou} needs you
              </span>
            )}
            <OpenInboxButton accent={accent} onClick={onOpenInbox} />
          </div>
        }
      />
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column" }}>
        {flat.map((e) => (
          <div
            key={e.id}
            role="button"
            tabIndex={0}
            onClick={() => onJump?.({ kind: "email", id: e.id, email: e })}
            onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") onJump?.({ kind: "email", id: e.id, email: e }); }}
            style={{
              display: "grid", gridTemplateColumns: isMobile ? "18px minmax(0, 1fr)" : "18px 1fr auto", gap: 10, alignItems: isMobile ? "start" : "center",
              padding: isMobile ? "10px 2px" : "9px 2px", borderBottom: "1px solid rgba(255,255,255,0.04)",
              cursor: "pointer",
            }}
            onMouseEnter={(ev) => { ev.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
            onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; }}
          >
            <div
              style={{
                width: 6, height: 6, borderRadius: 99,
                background:
                  e._lane === "action" ? "#f38ba8"
                  : e._lane === "fyi" ? "#89dceb"
                  : "rgba(205,214,244,0.25)",
                margin: "0 auto",
                opacity: e.read ? 0.35 : 1,
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12, color: e.read ? "rgba(205,214,244,0.65)" : "#cdd6f4",
                  fontWeight: e.read ? 400 : 600,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isMobile ? "normal" : "nowrap",
                  marginBottom: 2,
                }}
              >
                {e.subject}
              </div>
              <div
                style={{
                  fontSize: 10.5, color: "rgba(205,214,244,0.45)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isMobile ? "normal" : "nowrap",
                }}
              >
                {e.from}
              </div>
              {isMobile && (
                <div
                  style={{
                    fontSize: 9.5, color: "rgba(205,214,244,0.35)",
                    fontVariantNumeric: "tabular-nums",
                    marginTop: 6,
                  }}
                >
                  {timeAgo(e.date)}
                </div>
              )}
            </div>
            {!isMobile && (
              <div
                style={{
                  fontSize: 9.5, color: "rgba(205,214,244,0.35)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {timeAgo(e.date)}
              </div>
            )}
          </div>
        ))}
        {flat.length === 0 && <EmptyRow icon={Inbox} label="Nothing new — inbox is calm" />}
      </div>
    </div>
  );
}

function EmptyRow({ icon, label }) {
  const Icon = icon;
  return (
    <div
      style={{
        padding: "20px 14px", textAlign: "center",
        fontSize: 11.5, color: "rgba(205,214,244,0.4)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      }}
    >
      <Icon size={16} color="rgba(205,214,244,0.25)" />
      {label}
    </div>
  );
}

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = Math.max(0, (Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${Math.round(mins)}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h`;
  const days = hrs / 24;
  if (days < 7) return `${Math.round(days)}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
