import { Bell, Flag } from "lucide-react";
import { motion as Motion } from "motion/react";
import { daysUntil } from "../../../../lib/bill-utils";
import { urgencyForDays } from "../../../../lib/redesign-helpers";
import {
  RailFactTile,
  RailHeroCard,
  RailMetaChip,
  RailReminderIndicator,
} from "../../DetailRailPrimitives.jsx";
import { useDetailRailMotion } from "../../detailRailMotion.js";
import {
  DeadlineStatusBadge,
  DeadlineStatusValue,
} from "./DeadlineStatusIndicator.jsx";
import {
  PRIORITY_META,
  SOURCE_COLORS,
  normalizeStatus,
  sourceLabelFor,
  sourceOf,
} from "./deadlinesModel.js";
import {
  deadlineContextLabel,
  deadlineDueBadgeLabel,
  deadlineDueDetailLabel,
  deadlineSecondaryMeta,
  deadlineTitle,
} from "./deadlineDetailModel.js";
import { formatReminderSummary } from "../../reminderDisplay.js";

function PriorityBadge({ level, compact = false }) {
  const meta = PRIORITY_META[level];
  if (!meta) return null;
  return (
    <RailMetaChip tone="accent" color={meta.color} compact={compact}>
      <Flag size={compact ? 9 : 10} strokeWidth={2.2} />
      {meta.label}
    </RailMetaChip>
  );
}

function deadlinePillColor({ normalizedStatus, hasDueDate, urgency, accent }) {
  if (normalizedStatus === "complete") return "#a6e3a1";
  if (!hasDueDate) return "rgba(205,214,244,0.7)";
  if (urgency.key === "high") return "#f38ba8";
  if (urgency.key === "medium") return "#f9e2af";
  return accent;
}

export default function DeadlineDetailCard({
  task,
  accent,
  compact = false,
  ultraCompact = false,
  actions,
}) {
  const motion = useDetailRailMotion();
  const source = sourceOf(task);
  const sourceLabel = sourceLabelFor(task);
  const sourceColor = SOURCE_COLORS[source] || accent;
  const isTodoist = source === "todoist";
  const normalizedStatus = normalizeStatus(task.status);
  const dueDays = daysUntil(task.due_date);
  const urgency = urgencyForDays(dueDays, accent);
  const dueColor = deadlinePillColor({
    normalizedStatus,
    hasDueDate: !!task.due_date,
    urgency,
    accent,
  });
  const title = deadlineTitle(task);
  const contextLabel = deadlineContextLabel(task);
  const dueBadgeLabel = deadlineDueBadgeLabel(task, dueDays);
  const dueDetailLabel = deadlineDueDetailLabel(task);
  const secondaryMeta = deadlineSecondaryMeta(task);
  const showPriorityChip = isTodoist && PRIORITY_META[task.priority];
  const showPointsChip = task.points_possible != null;
  const density = ultraCompact ? "compressed" : compact ? "compact" : "default";
  const reminderSummary = formatReminderSummary(task);

  if (ultraCompact) {
    return (
      <Motion.div
        layout
        transition={motion.layout}
        data-testid="calendar-selected-deadline-card"
        data-density={density}
        data-height-mode="auto"
        style={{ flexShrink: 0 }}
      >
        <RailHeroCard accent={accent} compact actions={actions}>
          <Motion.div
            layout
            transition={motion.layout}
            style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexShrink: 0 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: sourceColor,
                  boxShadow: `0 0 0 1px ${sourceColor}22, 0 0 8px ${sourceColor}2b`,
                }}
              />
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: sourceColor,
                  whiteSpace: "nowrap",
                }}
              >
                {sourceLabel}
              </div>
            </div>
            <div
              style={{
                flexShrink: 0,
                padding: "5px 8px",
                borderRadius: 999,
                border: `1px solid ${dueColor}30`,
                background: `${dueColor}14`,
                color: dueColor,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.2,
                whiteSpace: "nowrap",
              }}
            >
              {dueBadgeLabel}
            </div>
          </Motion.div>

          <Motion.div layout transition={motion.layout} style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
            <Motion.div
              layout="position"
              transition={motion.layout}
              data-testid="calendar-selected-deadline-title"
              style={{
                fontSize: 17,
                fontWeight: 500,
                color: "#fff",
                lineHeight: 1.08,
                letterSpacing: -0.3,
                textDecoration: normalizedStatus === "complete" ? "line-through" : "none",
                textDecorationColor: "rgba(205,214,244,0.35)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {title}
            </Motion.div>
            <Motion.div
              layout
              transition={motion.layout}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "6px 8px",
              }}
            >
              <span
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.35,
                  color: dueColor,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {dueDetailLabel}
              </span>
              <DeadlineStatusBadge
                status={task.status}
                compact
                testId="calendar-selected-deadline-status"
              />
              {showPriorityChip ? <PriorityBadge level={task.priority} compact /> : null}
              {reminderSummary ? (
                <RailReminderIndicator compact>
                  <Bell size={10} strokeWidth={2.2} />
                  {reminderSummary}
                </RailReminderIndicator>
              ) : null}
              {secondaryMeta ? (
                <span
                  style={{
                    fontSize: 11.5,
                    lineHeight: 1.4,
                    color: "rgba(205,214,244,0.56)",
                    display: "-webkit-box",
                    WebkitLineClamp: 1,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {secondaryMeta}
                </span>
              ) : null}
            </Motion.div>
          </Motion.div>
        </RailHeroCard>
      </Motion.div>
    );
  }

  return (
    <Motion.div
      layout
      transition={motion.layout}
      data-testid="calendar-selected-deadline-card"
      data-density={density}
      data-height-mode="auto"
      style={{ flexShrink: 0 }}
    >
      <RailHeroCard accent={accent} compact={compact} actions={actions}>
        <Motion.div
          layout
          transition={motion.layout}
          style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexShrink: 0 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: sourceColor,
                boxShadow: `0 0 0 1px ${sourceColor}22, 0 0 8px ${sourceColor}2b`,
              }}
            />
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: sourceColor,
                whiteSpace: "nowrap",
              }}
            >
              {sourceLabel}
            </div>
          </div>
          <div
            style={{
              flexShrink: 0,
              padding: "5px 8px",
              borderRadius: 999,
              border: `1px solid ${dueColor}30`,
              background: `${dueColor}14`,
              color: dueColor,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.2,
              whiteSpace: "nowrap",
            }}
          >
            {dueBadgeLabel}
          </div>
        </Motion.div>

        <Motion.div layout transition={motion.layout} style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6, flexShrink: 0 }}>
          <Motion.div
            layout="position"
            transition={motion.layout}
            data-testid="calendar-selected-deadline-title"
            style={{
              fontSize: compact ? 17 : 18,
              fontWeight: 500,
              color: "#fff",
              lineHeight: 1.12,
              letterSpacing: compact ? -0.3 : -0.32,
              textDecoration: normalizedStatus === "complete" ? "line-through" : "none",
              textDecorationColor: "rgba(205,214,244,0.35)",
              display: "-webkit-box",
              WebkitLineClamp: compact ? 2 : 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {title}
          </Motion.div>
          {contextLabel ? (
            <Motion.div
              layout="position"
              transition={motion.layout}
              style={{
                fontSize: compact ? 10 : 10.5,
                color: "rgba(205,214,244,0.54)",
                display: "-webkit-box",
                WebkitLineClamp: compact ? 1 : 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {contextLabel}
            </Motion.div>
          ) : null}
        </Motion.div>

        {(showPriorityChip || showPointsChip || !isTodoist || reminderSummary) ? (
          <Motion.div layout transition={motion.layout} style={{ display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
            {reminderSummary ? (
              <RailReminderIndicator compact={compact}>
                <Bell size={10} strokeWidth={2.2} />
                {reminderSummary}
              </RailReminderIndicator>
            ) : null}
            {showPriorityChip ? <PriorityBadge level={task.priority} compact={compact} /> : null}
            {showPointsChip ? <RailMetaChip tone="quiet" compact={compact}>{task.points_possible} pts</RailMetaChip> : null}
            {!isTodoist ? <RailMetaChip tone="quiet" compact={compact}>{sourceLabel}</RailMetaChip> : null}
          </Motion.div>
        ) : null}

        <Motion.div
          layout
          transition={motion.layout}
          style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, flexShrink: 0 }}
        >
          <RailFactTile
            label="Due"
            value={task.due_date ? `${dueBadgeLabel}${task.due_time ? ` · ${task.due_time}` : ""}` : "No due date"}
            color={dueColor}
            valueNoWrap
            valueFontSize={compact ? 11 : 12}
          />
          <RailFactTile
            label="Status"
            value={(
              <DeadlineStatusValue
                status={task.status}
                size={compact ? 11 : 12}
                testId="calendar-selected-deadline-status"
              />
            )}
            valueNoWrap
            valueFontSize={compact ? 11 : 12}
          />
        </Motion.div>
      </RailHeroCard>
    </Motion.div>
  );
}
