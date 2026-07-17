import { Check, ExternalLink, Pencil } from "lucide-react";
import {
  RailAction,
  RailActionGroup,
} from "../../DetailRailPrimitives.tsx";
import {
  normalizeStatus,
  openInNewTab,
} from "./deadlinesModel.ts";
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { DeadlineItem } from "./deadlinesModel";

interface DeadlineActionCallbacks {
  onComplete: (id: string | undefined, task: DeadlineItem) => void;
  onEdit: (task: DeadlineItem) => void;
}

const Action = RailAction as ComponentType<{
  icon: LucideIcon;
  label: string;
  accent?: string;
  tone?: string;
  size?: string;
  disabled?: boolean;
  loading?: boolean;
  href?: string;
  onClick?: () => void;
}>;

function DeadlinePrimaryActions({
  task,
  normalizedStatus,
  isCompleting,
  accent,
  onComplete,
  onEdit,
  compact = false,
  hideEdit = false,
}: DeadlineActionCallbacks & {
  task: DeadlineItem;
  normalizedStatus: string;
  isCompleting: boolean;
  accent?: string;
  compact?: boolean;
  hideEdit?: boolean;
}) {
  const size = compact ? "compact" : "default";
  const completeLabel = compact ? "Complete" : "Mark complete";

  return (
    <>
      {normalizedStatus !== "complete" ? (
        <Action
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
        <Action
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
  accent = "var(--ea-accent)",
  compact = false,
}: {
  task: DeadlineItem;
  isCompleting: boolean;
  accent?: string;
  compact?: boolean;
}) {
  const size = compact ? "compact" : "default";
  const todoistUrl = task.url && /todoist/i.test(task.url) ? task.url : null;

  return todoistUrl ? (
    <Action
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
  accent = "var(--ea-accent)",
  onEdit,
  onComplete,
  compact = false,
  hideEdit = false,
}: DeadlineActionCallbacks & {
  task?: DeadlineItem | null;
  accent?: string;
  compact?: boolean;
  hideEdit?: boolean;
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
