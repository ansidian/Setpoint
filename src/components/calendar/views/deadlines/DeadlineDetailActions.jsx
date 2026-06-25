import { Check, ExternalLink, Pencil } from "lucide-react";
import {
  RailAction,
  RailActionGroup,
} from "../../DetailRailPrimitives.jsx";
import {
  normalizeStatus,
  openInNewTab,
} from "./deadlinesModel.js";

function DeadlinePrimaryActions({
  task,
  normalizedStatus,
  isCompleting,
  accent,
  onComplete,
  onEdit,
  compact = false,
  hideEdit = false,
}) {
  const size = compact ? "compact" : "default";
  const completeLabel = compact ? "Complete" : "Mark complete";

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
          onClick={() => onComplete(task.id, task)}
        />
      ) : null}
      {hideEdit ? null : (
        <RailAction
          icon={Pencil}
          label="Edit"
          accent={accent}
          size={size}
          disabled={isCompleting}
          onClick={() => onEdit(task)}
        />
      )}
    </>
  );
}

function DeadlineExternalActions({
  task,
  isCompleting,
  accent,
  compact = false,
}) {
  const size = compact ? "compact" : "default";
  const todoistUrl = task.url && /todoist/i.test(task.url) ? task.url : null;

  return todoistUrl ? (
    <RailAction
      icon={ExternalLink}
      label={compact ? "Open Todoist" : "Open in Todoist"}
      accent={accent}
      tone="ghost"
      size={size}
      disabled={isCompleting}
      onClick={() => openInNewTab(todoistUrl)}
    />
  ) : null;
}

export default function DeadlineSelectedActions({
  task,
  accent,
  onEdit,
  onComplete,
  compact = false,
  hideEdit = false,
}) {
  if (!task) return null;
  const normalizedStatus = normalizeStatus(task.status);
  const isCompleting = !!task._completing;
  const hasExternalActions = !!(task.url && /todoist/i.test(task.url));

  return (
    <RailActionGroup>
      <DeadlinePrimaryActions
        task={task}
        normalizedStatus={normalizedStatus}
        isCompleting={isCompleting}
        accent={accent}
        onComplete={onComplete}
        onEdit={onEdit}
        compact={compact}
        hideEdit={hideEdit}
      />
      {hasExternalActions ? (
        <DeadlineExternalActions
          task={task}
          isCompleting={isCompleting}
          accent={accent}
          compact={compact}
        />
      ) : null}
    </RailActionGroup>
  );
}
