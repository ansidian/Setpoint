import { useState } from "react";
import { createPortal } from "react-dom";
import AddTaskPanelFloatingEditor from "./AddTaskPanelFloatingEditor";
import AddTaskPanelInlineEditor from "./AddTaskPanelInlineEditor";
import { formatFriendlyDraftPreview } from "./formatDraftPreview";
import type { TodoistPriority } from "../../../../shared/types/tasks";
import type { CompactPanel, EditMetadataItem, TodoistEditorTask } from "./types";
import type useAddTaskPanelController from "./useAddTaskPanelController";

function buildEditMetadataItems({
  editingTask,
  isEdit,
  resolvedLabels,
  resolvedPriority,
  resolvedProject,
}: {
  editingTask?: TodoistEditorTask | null;
  isEdit: boolean;
  resolvedLabels: Array<{ name: string }>;
  resolvedPriority: TodoistPriority;
  resolvedProject: { name: string } | null;
}): EditMetadataItem[] {
  if (!isEdit) return [];
  const originalDueText = editingTask?.due_date
    ? formatFriendlyDraftPreview({ dueDate: editingTask.due_date, dueTime: editingTask.due_time })
    : "No due date";
  return [
    {
      id: "due",
      text: originalDueText,
      color: editingTask?.due_date ? "color-mix(in srgb, var(--sp-cream) 86%, transparent)" : "var(--color-text-faint)",
    },
    (resolvedProject?.name || editingTask?.class_name || editingTask?.project_name) ? {
      id: "project",
      text: resolvedProject?.name || editingTask?.class_name || editingTask?.project_name,
      color: "color-mix(in srgb, var(--sp-accent) 86%, transparent)",
    } : null,
    resolvedPriority ? {
      id: "priority",
      text: `P${resolvedPriority}`,
      color: resolvedPriority <= 2 ? "var(--sp-rose)" : resolvedPriority === 3 ? "var(--sp-blue)" : "rgba(205,214,244,0.7)",
    } : null,
    resolvedLabels.length ? {
      id: "labels",
      text: resolvedLabels.map((label) => label.name).join(", "),
      color: "var(--sp-teal)",
    } : null,
  ].filter((item): item is EditMetadataItem => item !== null);
}

export default function AddTaskPanelView({
  controller,
}: {
  controller: ReturnType<typeof useAddTaskPanelController>;
  host?: string;
}) {
  const {
    active,
    editingTask,
    host,
    isEdit,
    isInline,
    isMobile,
    pos,
    requestClose,
    resolvedLabels,
    resolvedPriority,
    resolvedProject,
  } = controller;
  const [openCompactPanel, setOpenCompactPanel] = useState<CompactPanel>(null);

  if (!isInline && !pos) return null;

  const editMetadataItems = buildEditMetadataItems({
    editingTask,
    isEdit,
    resolvedLabels,
    resolvedPriority,
    resolvedProject,
  });

  if (isInline) {
    return (
      <AddTaskPanelInlineEditor
        active={active}
        editMetadataItems={editMetadataItems}
        openCompactPanel={openCompactPanel}
        setOpenCompactPanel={setOpenCompactPanel}
        state={controller}
      />
    );
  }

  const content = (
    <AddTaskPanelFloatingEditor
      active={active}
      state={controller}
    />
  );

  return createPortal(
    <>
      {isMobile && (
        <div
          aria-hidden="true"
          onClick={requestClose}
          onTouchMove={(event) => event.preventDefault()}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 9998,
          }}
        />
      )}
      {!isMobile && host === "modal" && (
        <div
          aria-hidden="true"
          onClick={requestClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(2px)",
            zIndex: 9998,
            opacity: active ? 1 : 0,
            transition: "opacity 150ms ease",
          }}
        />
      )}
      {content}
    </>,
    document.body,
  );
}
