/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { Check, Circle, CircleDashed, ExternalLink, Flag, Pencil } from "lucide-react";
import { motion as Motion } from "motion/react";
import { daysUntil } from "../../../../lib/bill-utils";
import { daysLabel, urgencyForDays } from "../../../../lib/redesign-helpers";
import { useDashboard } from "../../../../context/DashboardContext.jsx";
import AddTaskPanel from "../../../todoist/AddTaskPanel";
import {
  RailAction,
  RailActionGroup,
  RailFactTile,
  RailHeroCard,
  RailMetaChip,
} from "../../DetailRailPrimitives.jsx";
import { useDetailRailMotion } from "../../detailRailMotion.js";
import TimelineDetailRail from "../../TimelineDetailRail.jsx";
import {
  formatFullDate,
  getDayState,
  normalizeStatus,
  openInNewTab,
  PRIORITY_META,
  SOURCE_COLORS,
  sourceLabelFor,
  sourceOf,
} from "./deadlinesModel.js";
import {
  DeadlineStatusBadge,
  DeadlineStatusIcon,
  DeadlineStatusValue,
} from "./DeadlineStatusIndicator.jsx";

function PriorityBadge({ level }) {
  const meta = PRIORITY_META[level];
  if (!meta) return null;
  return (
    <RailMetaChip tone="accent" color={meta.color}>
      <Flag size={10} strokeWidth={2.2} />
      {meta.label}
    </RailMetaChip>
  );
}

function deadlineTitle(task) {
  return task.title || task.name || "Untitled task";
}

function deadlineContextLabel(task) {
  return task.class_name || task.project_name || null;
}

function deadlineDueBadgeLabel(task, dueDays) {
  return task.due_date ? daysLabel(dueDays) : "No due date";
}

function deadlineDueDetailLabel(task) {
  if (!task.due_date) return "No due date";
  return task.due_time || "End of day";
}

function deadlineSecondaryMeta(task) {
  return deadlineContextLabel(task);
}

function shouldCompressDeadlineCard(task) {
  if (!task) return false;
  const title = deadlineTitle(task);
  const contextLabel = deadlineContextLabel(task) || "";
  const titleWordCount = title.split(/\s+/).filter(Boolean).length;

  return Boolean(
    title.length >= 24
    || titleWordCount >= 4
    || contextLabel.length >= 28
    || deadlineDueDetailLabel(task).length >= 14
  );
}

function DeadlinePrimaryActions({
  task,
  isTodoist,
  normalizedStatus,
  isCompleting,
  accent,
  onComplete,
  onEdit,
  onStatusChange,
  compact = false,
}) {
  const size = compact ? "compact" : "default";
  const completeLabel = isCompleting
    ? "Completing..."
    : compact
      ? "Complete"
      : "Mark complete";

  if (isTodoist) {
    return (
      <>
        {normalizedStatus !== "complete" ? (
          <RailAction
            icon={Check}
            label={completeLabel}
            accent={accent}
            tone="success"
            size={size}
            disabled={isCompleting}
            loading={isCompleting}
            onClick={() => onComplete(task.id)}
          />
        ) : null}
        <RailAction
          icon={Pencil}
          label="Edit"
          accent={accent}
          size={size}
          disabled={isCompleting}
          onClick={() => onEdit(task)}
        />
      </>
    );
  }

  return (
    <>
      {normalizedStatus !== "complete" ? (
        <RailAction
          icon={Check}
          label={compact ? "Complete" : "Mark complete"}
          accent={accent}
          tone="success"
          size={size}
          onClick={() => onStatusChange(task.id, "complete")}
        />
      ) : null}
      {normalizedStatus !== "in_progress" ? (
        <RailAction
          icon={CircleDashed}
          label="In progress"
          accent={accent}
          size={size}
          onClick={() => onStatusChange(task.id, "in_progress")}
        />
      ) : null}
      {normalizedStatus !== "incomplete" ? (
        <RailAction
          icon={Circle}
          label="Reopen"
          accent={accent}
          size={size}
          onClick={() => onStatusChange(task.id, "incomplete")}
        />
      ) : null}
    </>
  );
}

function DeadlineExternalActions({
  task,
  isTodoist,
  isCompleting,
  accent,
  ctmUrl,
  compact = false,
}) {
  const size = compact ? "compact" : "default";

  if (isTodoist) {
    return task.url ? (
      <RailAction
        icon={ExternalLink}
        label={compact ? "Open Todoist" : "Open in Todoist"}
        accent={accent}
        tone="ghost"
        size={size}
        disabled={isCompleting}
        onClick={() => openInNewTab(task.url)}
      />
    ) : null;
  }

  return (
    <>
      {task.url && /instructure\.com|canvas/i.test(task.url) ? (
        <RailAction
          icon={ExternalLink}
          label={compact ? "Open Canvas" : "Open in Canvas"}
          accent={accent}
          tone="ghost"
          size={size}
          onClick={() => openInNewTab(task.url)}
        />
      ) : null}
      <RailAction
        icon={ExternalLink}
        label={compact ? "Open CTM" : "Open in CTM"}
        accent={accent}
        tone="ghost"
        size={size}
        onClick={() => openInNewTab(ctmUrl)}
      />
    </>
  );
}

function DeadlineSelectedActions({
  task,
  accent,
  onEdit,
  onComplete,
  onStatusChange,
  compact = false,
}) {
  if (!task) return null;
  const source = sourceOf(task);
  const isTodoist = source === "todoist";
  const normalizedStatus = normalizeStatus(task.status);
  const isCompleting = !!task._completing;
  const ctmUrl = `https://ctm.andysu.tech/#/event/${task.id}`;
  const hasExternalActions = isTodoist
    ? !!task.url
    : true;

  return (
    <RailActionGroup>
      <DeadlinePrimaryActions
        task={task}
        isTodoist={isTodoist}
        normalizedStatus={normalizedStatus}
        isCompleting={isCompleting}
        accent={accent}
        onComplete={onComplete}
        onEdit={onEdit}
        onStatusChange={onStatusChange}
        compact={compact}
      />
      {hasExternalActions ? (
        <DeadlineExternalActions
          task={task}
          isTodoist={isTodoist}
          isCompleting={isCompleting}
          accent={accent}
          ctmUrl={ctmUrl}
          compact={compact}
        />
      ) : null}
    </RailActionGroup>
  );
}

function DetailCard({
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
  const dueColor = task.due_date
    ? urgency.key === "high"
      ? "#f38ba8"
      : urgency.key === "medium"
        ? "#f9e2af"
        : accent
    : "rgba(205,214,244,0.7)";
  const title = deadlineTitle(task);
  const contextLabel = deadlineContextLabel(task);
  const dueBadgeLabel = deadlineDueBadgeLabel(task, dueDays);
  const dueDetailLabel = deadlineDueDetailLabel(task);
  const secondaryMeta = deadlineSecondaryMeta(task);
  const showPriorityChip = isTodoist && PRIORITY_META[task.priority];
  const showPointsChip = task.points_possible != null;
  const density = ultraCompact ? "compressed" : compact ? "compact" : "default";

  if (ultraCompact) {
    return (
      <Motion.div
        layout
        transition={motion.layout}
        data-testid="calendar-selected-deadline-card"
        data-density={density}
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

        {!compact && (showPriorityChip || showPointsChip || !isTodoist) ? (
          <Motion.div layout transition={motion.layout} style={{ display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
            {showPriorityChip ? <PriorityBadge level={task.priority} /> : null}
            {showPointsChip ? <RailMetaChip tone="quiet">{task.points_possible} pts</RailMetaChip> : null}
            {!isTodoist ? <RailMetaChip tone="quiet">{sourceLabel}</RailMetaChip> : null}
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

function DeadlinesDetail({
  selectedDay,
  viewYear,
  viewMonth,
  items,
  selectedItemId,
  onSelectItem,
  editorState,
  onStartEdit,
  onCloseEditor,
  onTaskSaved,
  onTaskDeleted,
  accent = "var(--ea-accent)",
  supportBandActive = false,
}) {
  const {
    handleCompleteTask,
    handleUpdateTaskStatus,
    handleUpdateTask,
    handleAddTask,
    handleDeleteTask,
  } = useDashboard();

  const state = getDayState(items);
  const allItems = [...state.activeItems, ...state.completedItems];
  const selectedTask = allItems.find((task) => String(task.id) === String(selectedItemId)) || null;
  const compressedSelectedCard = state.totalCount >= 2 || shouldCompressDeadlineCard(selectedTask);
  const compactDetail = state.totalCount >= 2;
  const effectiveCompactDetail = compactDetail || compressedSelectedCard;
  const [showCompleted, setShowCompleted] = useState(
    state.activeCount === 0 || normalizeStatus(selectedTask?.status) === "complete",
  );
  const summary = [
    `${state.activeCount} open`,
    state.completedCount ? `${state.completedCount} complete` : null,
    `${state.totalCount} total`,
  ].filter(Boolean).join(" · ");

  const expandedCompleted = showCompleted || normalizeStatus(selectedTask?.status) === "complete";

  if (editorState?.mode) {
    const editingTask = editorState.mode === "edit"
      ? allItems.find((task) => String(task.id) === String(editorState.taskId)) || selectedTask
      : null;
    const seedDate = editingTask ? null : editorState.seedDate || null;

    return (
      <AddTaskPanel
        host="inline"
        editingTask={editingTask || undefined}
        initialDueDate={seedDate}
        onClose={onCloseEditor}
        onTaskAdded={(task) => {
          handleAddTask(task);
          onTaskSaved?.(task);
        }}
        onTaskUpdated={(task) => {
          handleUpdateTask(task);
          onTaskSaved?.(task);
        }}
        onTaskDeleted={(taskId) => {
          handleDeleteTask(taskId);
          onTaskDeleted?.(taskId);
        }}
      />
    );
  }

  return (
    <TimelineDetailRail
      eyebrow="Deadline ledger"
      title={formatFullDate(viewYear, viewMonth, selectedDay)}
      summary={summary}
      accent={accent}
      supportBandActive={supportBandActive}
      headerContent={
        selectedTask ? (
          <DetailCard
            task={selectedTask}
            accent={accent}
            compact={effectiveCompactDetail}
            ultraCompact={compressedSelectedCard}
            actions={
              <DeadlineSelectedActions
                task={selectedTask}
                accent={accent}
                onEdit={onStartEdit}
                onComplete={handleCompleteTask}
                onStatusChange={handleUpdateTaskStatus}
                compact={effectiveCompactDetail || supportBandActive}
              />
            }
          />
        ) : null
      }
      sections={[
        {
          id: "active-deadlines",
          label: "Active",
          items: state.activeItems.map((task) => {
            const sourceLabel = sourceLabelFor(task);
            const subtitle = task.class_name || task.project_name || sourceLabel;
            const metaParts = [];
            if (subtitle !== sourceLabel) metaParts.push(sourceLabel);
            if (normalizeStatus(task.status) === "in_progress") metaParts.push("In progress");

            return {
              id: `${sourceOf(task)}-${task.id}`,
              timeLabel: task.due_time || "End of day",
              title: task.title || task.name || "Untitled",
              subtitle,
              meta: metaParts.join(" · "),
              dotColor: SOURCE_COLORS[sourceOf(task)] || "rgba(255,255,255,0.3)",
              complete: normalizeStatus(task.status) === "complete",
              trailing: (
                <DeadlineStatusIcon
                  status={task.status}
                  size={14}
                  testId={`deadline-status-indicator-${task.id}`}
                />
              ),
              selected: String(task.id) === String(selectedItemId),
              onClick: () => onSelectItem?.(String(task.id)),
            };
          }),
        },
        {
          id: "completed-deadlines",
          label: "Completed",
          collapsible: true,
          expanded: expandedCompleted,
          onToggle: () => setShowCompleted((prev) => !prev),
          itemCount: state.completedCount,
          items: state.completedItems.map((task) => {
            const sourceLabel = sourceLabelFor(task);
            const subtitle = task.class_name || task.project_name || sourceLabel;
            const metaParts = [];
            if (subtitle !== sourceLabel) metaParts.push(sourceLabel);
            metaParts.push("Complete");

            return {
              id: `${sourceOf(task)}-${task.id}`,
              timeLabel: task.due_time || "End of day",
              title: task.title || task.name || "Untitled",
              subtitle,
              meta: metaParts.join(" · "),
              dotColor: SOURCE_COLORS[sourceOf(task)] || "rgba(255,255,255,0.3)",
              complete: true,
              trailing: (
                <DeadlineStatusIcon
                  status={task.status}
                  size={14}
                  testId={`deadline-status-indicator-${task.id}`}
                />
              ),
              selected: String(task.id) === String(selectedItemId),
              onClick: () => onSelectItem?.(String(task.id)),
            };
          }),
        },
      ]}
    />
  );
}

export function renderDeadlinesDetail(props) {
  const state = getDayState(props.items);
  return <DeadlinesDetail key={`${props.selectedDay}-${state.activeCount}-${state.completedCount}`} {...props} />;
}
