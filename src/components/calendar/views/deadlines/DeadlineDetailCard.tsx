import CompletionTransition from "../../../dashboard/CompletionTransition";
import { Bell, Flag } from "lucide-react";
import { motion as Motion } from "motion/react";
import type { Transition } from "motion/react";
import type { ComponentType, ReactNode } from "react";
import { daysUntil } from "../../../../lib/bill-utils";
import { urgencyForDays } from "../../../../lib/shell-helpers";
import {
  RailFactTile,
  RailHeroCard,
  RailMetaChip,
  RailReminderIndicator,
} from "../../DetailRailPrimitives.tsx";
import { useDetailRailMotion } from "../../detailRailMotion.ts";
import {
  DeadlineStatusBadge,
  DeadlineStatusValue,
} from "./DeadlineStatusIndicator.tsx";
import {
  DEADLINE_COLOR,
  PRIORITY_META,
  deadlineAccentFor,
  normalizeStatus,
} from "./deadlinesModel.ts";
import {
  deadlineContextLabel,
  deadlineDueBadgeLabel,
  deadlineDueDetailLabel,
  deadlineSecondaryMeta,
  deadlineTitle,
} from "./deadlineDetailModel.ts";
import { formatReminderSummary } from "../../reminderDisplay.ts";
import type { DeadlineItem } from "./deadlinesModel";

const FactTile = RailFactTile as ComponentType<{
  label: ReactNode;
  value: ReactNode;
  color?: string;
  valueNoWrap?: boolean;
  valueFontSize?: number;
}>;
const MetaChip = RailMetaChip as ComponentType<{ children?: ReactNode; tone?: string; color?: string; compact?: boolean }>;

function PriorityBadge({ level, compact = false }: { level?: number | null; compact?: boolean }) {
  const meta = level === 1 || level === 2 || level === 3 ? PRIORITY_META[level] : null;
  if (!meta) return null;
  return (
    <MetaChip tone="accent" color={meta.color} compact={compact}>
      <Flag size={compact ? 9 : 10} strokeWidth={2.2} />
      {meta.label}
    </MetaChip>
  );
}

function deadlinePillColor({ normalizedStatus, hasDueDate, urgency, accent }: {
  normalizedStatus: string;
  hasDueDate: boolean;
  urgency: { key?: string };
  accent: string;
}): string {
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
}: {
  task: DeadlineItem;
  accent: string;
  compact?: boolean;
  ultraCompact?: boolean;
  actions?: ReactNode;
}) {
  const motion = useDetailRailMotion();
  const layoutTransition = motion.layout as Transition;
  const deadlineColor = deadlineAccentFor(task, DEADLINE_COLOR);
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
  const showPriorityChip = task.priority === 1 || task.priority === 2 || task.priority === 3;
  const showPointsChip = task.points_possible != null;
  const density = ultraCompact ? "compressed" : compact ? "compact" : "default";
  const reminderSummary = formatReminderSummary(task);

  if (ultraCompact) {
    return (
      <Motion.div
        layout
        transition={layoutTransition}
        data-testid="calendar-selected-deadline-card"
        data-density={density}
        data-height-mode="auto"
        style={{ flexShrink: 0 }}
      >
        <RailHeroCard accent={accent} compact actions={actions}>
          <CompletionTransition itemId={String(task.id)} completing={!!task._completing}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Motion.div
                layout
                transition={layoutTransition}
                style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexShrink: 0 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: deadlineColor,
                      boxShadow: `0 0 0 1px ${deadlineColor}22, 0 0 8px ${deadlineColor}2b`,
                    }}
                  />
                  <div
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: deadlineColor,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Deadline
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

              <Motion.div layout transition={layoutTransition} style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                <Motion.div
                  layout="position"
                  transition={layoutTransition}
                  className="calendar-detail-title" data-testid="calendar-selected-deadline-title"
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
                  transition={layoutTransition}
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
            </div>
          </CompletionTransition>
        </RailHeroCard>
      </Motion.div>
    );
  }

  return (
    <Motion.div
      layout
      transition={layoutTransition}
      data-testid="calendar-selected-deadline-card"
      data-density={density}
      data-height-mode="auto"
      style={{ flexShrink: 0 }}
    >
      <RailHeroCard accent={accent} compact={compact} actions={actions}>
        <CompletionTransition itemId={String(task.id)} completing={!!task._completing}>
          <div style={{ display: "flex", flexDirection: "column", gap: compact ? 8 : 10 }}>
            <Motion.div
              layout
              transition={layoutTransition}
              style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexShrink: 0 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                      borderRadius: 999,
                      background: deadlineColor,
                      boxShadow: `0 0 0 1px ${deadlineColor}22, 0 0 8px ${deadlineColor}2b`,
                    }}
                  />
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: 2,
                    textTransform: "uppercase",
                    color: deadlineColor,
                    whiteSpace: "nowrap",
                  }}
                >
                  Deadline
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

            <Motion.div layout transition={layoutTransition} style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6, flexShrink: 0 }}>
              <Motion.div
                layout="position"
                transition={layoutTransition}
                className="calendar-detail-title" data-testid="calendar-selected-deadline-title"
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
                  transition={layoutTransition}
                  style={{
                    fontSize: compact ? 10 : 10.5,
                    color: "var(--color-text-faint)",
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

            {(showPriorityChip || showPointsChip || reminderSummary) ? (
              <Motion.div layout transition={layoutTransition} style={{ display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
                {reminderSummary ? (
                  <RailReminderIndicator compact={compact}>
                    <Bell size={10} strokeWidth={2.2} />
                    {reminderSummary}
                  </RailReminderIndicator>
                ) : null}
                {showPriorityChip ? <PriorityBadge level={task.priority} compact={compact} /> : null}
                {showPointsChip ? <MetaChip tone="quiet" compact={compact}>{task.points_possible} pts</MetaChip> : null}
              </Motion.div>
            ) : null}

            <Motion.div
              layout
              transition={layoutTransition}
              style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, flexShrink: 0 }}
            >
              <FactTile
                label="Due"
                value={task.due_date ? `${dueBadgeLabel}${task.due_time ? ` · ${task.due_time}` : ""}` : "No due date"}
                color={dueColor}
                valueNoWrap
                valueFontSize={compact ? 11 : 12}
              />
              <FactTile
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
          </div>
        </CompletionTransition>
      </RailHeroCard>
    </Motion.div>
  );
}
