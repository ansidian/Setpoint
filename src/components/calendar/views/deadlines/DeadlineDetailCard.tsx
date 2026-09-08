import CompletionTransition from "../../../dashboard/CompletionTransition";
import { Bell, CalendarDays, Flag } from "lucide-react";
import { motion as Motion } from "motion/react";
import type { Transition } from "motion/react";
import type { ReactNode } from "react";
import { daysUntil } from "../../../../lib/bill-utils";
import { urgencyForDays } from "../../../../lib/shell-helpers";
import { RailDueBadge, RailFactRow, RailHeroCard, RailMetaChip, RailReminderIndicator } from "../../DetailRailPrimitives.tsx";
import { useDetailRailMotion } from "../../detailRailMotion.ts";
import { DeadlineStatusValue } from "./DeadlineStatusIndicator.tsx";
import { PRIORITY_META, deadlineAccentFor, normalizeStatus } from "./deadlinesModel.ts";
import { deadlineSecondaryMeta, deadlineDueBadgeLabel, deadlineTitle } from "./deadlineDetailModel.ts";
import { formatReminderSummary } from "../../reminderDisplay.ts";
import type { DeadlineItem } from "./deadlinesModel";

export default function DeadlineDetailCard({ task, accent, compact = false, ultraCompact = false, actions }: {
  task: DeadlineItem;
  accent: string;
  compact?: boolean;
  ultraCompact?: boolean;
  actions?: ReactNode;
}) {
  const motion = useDetailRailMotion();
  const layoutTransition = motion.layout as Transition;
  const normalizedStatus = normalizeStatus(task.status);
  const dueDays = daysUntil(task.due_date);
  const urgency = urgencyForDays(dueDays, accent);
  const dueColor = normalizedStatus === "complete" ? "var(--sp-green)"
    : dueDays === null ? "var(--sp-subtext)"
      : urgency.key === "high" ? "#f38ba8" : urgency.key === "medium" ? "#f9e2af" : accent;
  const contextLabel = deadlineSecondaryMeta(task);
  const reminderSummary = formatReminderSummary(task);
  const priority = task.priority === 1 || task.priority === 2 || task.priority === 3 ? PRIORITY_META[task.priority] : null;
  const dueDate = task.due_date && dueDays !== null
    ? new Date(`${task.due_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : null;

  return (
    <Motion.div layout transition={layoutTransition} data-testid="calendar-selected-deadline-card"
      data-density={ultraCompact ? "compressed" : compact ? "compact" : "default"} data-height-mode="auto" style={{ flexShrink: 0 }}>
      <RailHeroCard accent={deadlineAccentFor(task, accent)} compact={compact} actions={actions}>
        <CompletionTransition itemId={String(task.id)} completing={!!task._completing}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div className="detail-card-heading">
                <h3 className="calendar-detail-title" data-testid="calendar-selected-deadline-title"
                  style={{ textDecoration: normalizedStatus === "complete" ? "line-through" : undefined, textDecorationColor: "rgba(205,214,244,.35)" }}>
                  {deadlineTitle(task)}
                </h3>
                <RailDueBadge color={dueColor}>{deadlineDueBadgeLabel(task, dueDays)}</RailDueBadge>
              </div>
              {contextLabel ? <div className="detail-card-context">{contextLabel}</div> : null}
            </div>
            {(priority || task.points_possible != null || reminderSummary) ? (
              <div className="detail-card-meta">
                {priority ? <RailMetaChip tone="accent" color={priority.color} compact><Flag size={12} aria-hidden="true" />{priority.label}</RailMetaChip> : null}
                {task.points_possible != null ? <RailMetaChip compact>{task.points_possible} pts</RailMetaChip> : null}
                {reminderSummary ? <RailReminderIndicator compact><Bell size={11} aria-hidden="true" />{reminderSummary}</RailReminderIndicator> : null}
              </div>
            ) : null}
            <dl className="detail-card-facts">
              <RailFactRow label="Due" color={dueColor}>
                <CalendarDays size={13} aria-hidden="true" />
                <span>{dueDate ? `${dueDate}${task.due_time ? ` · ${task.due_time}` : " · End of day"}` : "No due date"}</span>
              </RailFactRow>
              <RailFactRow label="Status"><DeadlineStatusValue status={task.status} size={13} testId="calendar-selected-deadline-status" /></RailFactRow>
            </dl>
          </div>
        </CompletionTransition>
      </RailHeroCard>
    </Motion.div>
  );
}
