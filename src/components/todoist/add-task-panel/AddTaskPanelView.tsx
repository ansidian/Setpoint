import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import AddTaskPanelFloatingEditor from "./AddTaskPanelFloatingEditor";
import AddTaskPanelInlineEditor from "./AddTaskPanelInlineEditor";
import type { CompactPanel } from "./types";
import type useAddTaskPanelController from "./useAddTaskPanelController";

export default function AddTaskPanelView({
  controller,
}: {
  controller: ReturnType<typeof useAddTaskPanelController>;
  host?: string;
}) {
  const {
    active,
    host,
    isInline,
    isMobile,
    pos,
    requestClose,
    duePickerOpen,
  } = controller;
  const [openCompactPanel, setOpenCompactPanel] = useState<CompactPanel>(null);

  useEffect(() => {
    if (!isInline || !active || !openCompactPanel || duePickerOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpenCompactPanel(null);
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [active, duePickerOpen, isInline, openCompactPanel]);

  if (!isInline && !pos) return null;

  if (isInline) {
    return (
      <AddTaskPanelInlineEditor
        active={active}
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
