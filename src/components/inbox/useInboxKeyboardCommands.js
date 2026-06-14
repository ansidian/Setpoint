import { useEffect } from "react";
import { getGmailUrl } from "../../lib/email-links";
import { defaultSnoozeTs } from "./helpers";
import { resolveInboxHotkeyAction, shouldSuspendInboxHotkeys } from "./inboxHotkeys";
import { shouldHandleInboxUndoHotkey } from "./inboxCommandModel.js";

function isEditableKeyTarget(target) {
  if (!target) return false;
  const tagName = target.tagName;
  return tagName === "INPUT"
    || tagName === "TEXTAREA"
    || tagName === "SELECT"
    || target.isContentEditable;
}

// Window-level inbox hotkeys: undo (⌘Z), search focus (⌘F), j/k navigation,
// o open-in-Gmail, and the single-key action set resolved through
// inboxHotkeys.js (h/d/s/a/n/f…). Extracted from useInboxController (EAD-329).
export default function useInboxKeyboardCommands({
  undoSlotRef,
  onUndo,
  searchRef,
  moveBy,
  selectedEmail,
  readOnly,
  onAction,
}) {
  useEffect(() => {
    function onKey(event) {
      if (shouldHandleInboxUndoHotkey({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        hasUndoSlot: !!undoSlotRef.current,
        editableTarget: isEditableKeyTarget(event.target),
      })) {
        event.preventDefault();
        event.stopPropagation();
        onUndo();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        searchRef.current?.focus();
        searchRef.current?.select?.();
        return;
      }

      if (
        shouldSuspendInboxHotkeys(event.target)
      ) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveBy(1);
      } else if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveBy(-1);
      } else if (key === "o") {
        event.preventDefault();
        if (!selectedEmail) return;
        const url = getGmailUrl(selectedEmail);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const action = resolveInboxHotkeyAction(key, selectedEmail, readOnly);
        if (!action) return;
        event.preventDefault();
        if (action.kind === "snooze-default") {
          onAction("snooze", defaultSnoozeTs());
        } else if (action.kind === "snapshot-move-lane") {
          onAction(action.kind, action.lane);
        } else {
          onAction(action.kind);
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveBy, onAction, onUndo, readOnly, searchRef, selectedEmail, undoSlotRef]);
}
