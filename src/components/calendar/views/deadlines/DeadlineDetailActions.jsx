import { Check, Circle, CircleDashed, ExternalLink, Pencil } from "lucide-react";
import {
  RailAction,
  RailActionGroup,
} from "../../DetailRailPrimitives.jsx";
import {
  normalizeStatus,
  openInNewTab,
  sourceOf,
} from "./deadlinesModel.js";

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

export default function DeadlineSelectedActions({
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
