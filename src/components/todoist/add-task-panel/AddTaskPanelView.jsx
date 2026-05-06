import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import AddTaskPanelFloatingEditor from "./AddTaskPanelFloatingEditor.jsx";
import AddTaskPanelInlineEditor from "./AddTaskPanelInlineEditor.jsx";
import { formatFriendlyDraftPreview } from "./formatDraftPreview.js";

function buildEditMetadataItems({
  draftPreview,
  editingTask,
  isEdit,
  resolvedLabels,
  resolvedPriority,
  resolvedProject,
  showDraftPreview,
}) {
  if (!isEdit) return [];
  return [
    !showDraftPreview && draftPreview?.dueDate ? {
      id: "due",
      text: formatFriendlyDraftPreview(draftPreview),
      color: "rgba(249,226,175,0.86)",
    } : null,
    (resolvedProject?.name || editingTask?.class_name || editingTask?.project_name) ? {
      id: "project",
      text: resolvedProject?.name || editingTask?.class_name || editingTask?.project_name,
      color: "rgba(203,166,218,0.86)",
    } : null,
    resolvedPriority ? {
      id: "priority",
      text: `P${resolvedPriority}`,
      color: resolvedPriority <= 2 ? "#f38ba8" : resolvedPriority === 3 ? "#89b4fa" : "rgba(205,214,244,0.7)",
    } : null,
    resolvedLabels.length ? {
      id: "labels",
      text: resolvedLabels.map((label) => label.name).join(", "),
      color: "#a6dac0",
    } : null,
  ].filter(Boolean);
}

export default function AddTaskPanelView({ controller }) {
  const {
    active,
    draftPreview,
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
    transientCloseToken,
  } = controller;
  const [openCompactPanelState, setOpenCompactPanelState] = useState(() => ({ token: transientCloseToken, value: null }));
  const openCompactPanel = openCompactPanelState.token === transientCloseToken ? openCompactPanelState.value : null;
  const setOpenCompactPanel = useCallback((nextValue) => {
    setOpenCompactPanelState((prev) => {
      const currentValue = prev.token === transientCloseToken ? prev.value : null;
      return {
        token: transientCloseToken,
        value: typeof nextValue === "function" ? nextValue(currentValue) : nextValue,
      };
    });
  }, [transientCloseToken]);

  if (!isInline && !pos) return null;

  const showDraftPreview = !!(draftPreview?.dueDate && (!draftPreview.isEditing || draftPreview.placementChanged));
  const editMetadataItems = buildEditMetadataItems({
    draftPreview,
    editingTask,
    isEdit,
    resolvedLabels,
    resolvedPriority,
    resolvedProject,
    showDraftPreview,
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
