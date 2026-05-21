import { useMemo } from "react";
import { AlertCircle, Bell } from "lucide-react";
import { daysUntil } from "../../../lib/bill-utils";
import { formatFullDate } from "../../../lib/dashboard-helpers";
import { formatReminderSummary } from "../../calendar/reminderDisplay.js";
import { Skeleton } from "@/components/ui/skeleton";
import Tooltip from "../../shared/Tooltip";
import {
  CountBadge,
  DeadlineStatusIcon,
  EmptyRow,
  PriorityFlag,
  RailGroupLabel,
  SectionHeader,
  UrgencyPill,
} from "./railPrimitives.jsx";
import { PRIORITY_COLOR } from "./railModel.js";

const MAX_VISIBLE_DEADLINES = 4;
const DEADLINE_ROW_MIN_HEIGHT = 49;
const DEADLINE_ROW_MIN_HEIGHT_MOBILE = 78;

function DeadlinesRailLoadingPlaceholder({ isMobile = false }) {
  return (
    <div
      data-testid="deadlines-rail-loading-placeholder"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        paddingTop: 2,
      }}
    >
      {Array.from({ length: MAX_VISIBLE_DEADLINES }).map((_, index) => (
        <div
          key={index}
          style={{
            minHeight: isMobile ? DEADLINE_ROW_MIN_HEIGHT_MOBILE : DEADLINE_ROW_MIN_HEIGHT,
            padding: isMobile ? "10px 2px" : "9px 2px",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            display: "grid",
            gridTemplateColumns: isMobile ? "16px minmax(0, 1fr)" : "16px 1fr auto",
            gap: 10,
            alignItems: isMobile ? "start" : "center",
          }}
        >
          <Skeleton className="h-[12px] w-[12px] rounded-full bg-white/8" />
          <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            <Skeleton className="h-[12px] w-[58%] bg-white/10" />
            <Skeleton className="h-[10px] w-[36%] bg-white/7" />
          </div>
          {!isMobile && <Skeleton className="h-[18px] w-[68px] bg-white/8" />}
        </div>
      ))}
    </div>
  );
}

export default function DeadlinesRail({ accent, deadlines = [], onJump, isMobile = false, loadingState = "ready" }) {
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

    const openAll = visible.filter(({ d }) => d.status !== "complete");
    const completedAll = visible.filter(({ d }) => d.status === "complete");
    const open = openAll.slice(0, MAX_VISIBLE_DEADLINES);
    const remainingSlots = Math.max(0, MAX_VISIBLE_DEADLINES - open.length);
    const completed = completedAll.slice(0, remainingSlots);
    return { open, completed };
  }, [deadlines]);

  const openCount = deadlines.filter((d) => d.status !== "complete").length;
  const showLoadingPlaceholder = loadingState === "empty_loading";
  const reservedListMinHeight = (isMobile ? DEADLINE_ROW_MIN_HEIGHT_MOBILE : DEADLINE_ROW_MIN_HEIGHT) * MAX_VISIBLE_DEADLINES;

  return (
    <div data-sect="deadlines">
      <SectionHeader
        title="Deadlines"
        isMobile={isMobile}
        right={showLoadingPlaceholder ? (
          <div
            data-testid="deadlines-rail-refresh-status"
            style={{ fontSize: 10, color: "rgba(205,214,244,0.46)" }}
          >
            Checking deadlines...
          </div>
        ) : <CountBadge n={openCount} />}
      />
      <div
        data-testid="deadlines-rail-list"
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          minHeight: showLoadingPlaceholder || grouped.open.length > 0 ? reservedListMinHeight : undefined,
        }}
      >
        {showLoadingPlaceholder ? <DeadlinesRailLoadingPlaceholder isMobile={isMobile} /> : null}
        {!showLoadingPlaceholder && grouped.open.length > 0 && (
          <DeadlineGroup
            label="Open"
            items={grouped.open}
            accent={accent}
            onJump={onJump}
            isMobile={isMobile}
          />
        )}
        {!showLoadingPlaceholder && grouped.completed.length > 0 && (
          <div style={{ marginTop: grouped.open.length > 0 ? 12 : 0 }}>
            <DeadlineGroup
              label="Completed"
              items={grouped.completed}
              accent={accent}
              onJump={onJump}
              isMobile={isMobile}
              tone="success"
              completed
            />
          </div>
        )}
        {!showLoadingPlaceholder && grouped.open.length === 0 && grouped.completed.length === 0 && (
          <EmptyRow icon={AlertCircle} label="No deadlines" />
        )}
      </div>
    </div>
  );
}

function DeadlineGroup({ label, items, accent, onJump, isMobile, tone, completed = false }) {
  return (
    <div>
      <RailGroupLabel label={label} count={items.length} tone={tone} />
      {items.map(({ d, days }) => (
        <DeadlineRow
          key={d.id}
          deadline={d}
          days={days}
          accent={accent}
          onJump={onJump}
          isMobile={isMobile}
          completed={completed}
        />
      ))}
    </div>
  );
}

function DeadlineRow({ deadline: d, days, accent, onJump, isMobile, completed }) {
  const showPriority = PRIORITY_COLOR[d.priority];
  const reminderSummary = formatReminderSummary(d);

  return (
    <div
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
        opacity: completed ? 0.55 : undefined,
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
            textDecoration: completed ? "line-through" : undefined,
            textDecorationColor: completed ? "rgba(205,214,244,0.35)" : undefined,
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
          {d.class_name || d.project_name || "Deadline"}
        </div>
        {reminderSummary ? (
          <div
            data-testid="dashboard-reminder-indicator"
            aria-label={reminderSummary}
            title={reminderSummary}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              maxWidth: "100%",
              marginTop: 5,
              padding: "2px 6px",
              borderRadius: 999,
              border: "1px solid rgba(249,226,175,0.28)",
              background: "rgba(249,226,175,0.10)",
              color: "#f9e2af",
              fontSize: 10,
              fontWeight: 650,
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            <Bell size={11} aria-hidden />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {reminderSummary}
            </span>
          </div>
        ) : null}
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
}
