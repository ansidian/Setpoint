import { useEffect, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import { getGmailUrl } from "../../lib/email-links";
import { defaultSnoozeTs } from "./helpers";
import { resolveInboxHotkeyAction, shouldSuspendInboxHotkeys } from "./inboxHotkeys";
import { shouldHandleInboxUndoHotkey } from "./inboxCommandModel";
import type { InboxEmailLike } from "./inboxTypes";
import type { InboxUndoSlot } from "./useInboxUndoSlot";
import type { InboxActionDispatcher } from "./useInboxActionDispatch";

function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
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
}: {
  undoSlotRef: MutableRefObject<InboxUndoSlot | null>;
  onUndo: () => unknown;
  searchRef: RefObject<HTMLInputElement | null>;
  moveBy: (direction: number) => void;
  selectedEmail: InboxEmailLike | null;
  readOnly: boolean;
  onAction: InboxActionDispatcher;
}) {
  // Keep the per-selection-volatile handlers/values in refs so the window
  // keydown listener can subscribe ONCE on mount instead of detaching and
  // re-attaching on every j/k nav or row click (selectedEmail, onAction and
  // moveBy all change identity per selection). Mirrors the undoSlotRef pattern.
  const handlersRef = useRef({ onUndo, moveBy, selectedEmail, readOnly, onAction });
  useEffect(() => {
    handlersRef.current = { onUndo, moveBy, selectedEmail, readOnly, onAction };
  }, [onUndo, moveBy, selectedEmail, readOnly, onAction]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const { onUndo: onUndoNow, moveBy: moveByNow, selectedEmail: selectedEmailNow, readOnly: readOnlyNow, onAction: onActionNow } = handlersRef.current;
      if (shouldHandleInboxUndoHotkey({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        hasUndoSlot: !!undoSlotRef.current,
        editableTarget: isEditableKeyTarget(event.target),
      })) {
        event.preventDefault();
        event.stopPropagation();
        onUndoNow();
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
        moveByNow(1);
      } else if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveByNow(-1);
      } else if (key === "o") {
        event.preventDefault();
        if (!selectedEmailNow) return;
        const url = getGmailUrl(selectedEmailNow);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const action = resolveInboxHotkeyAction(key, selectedEmailNow, readOnlyNow);
        if (!action) return;
        event.preventDefault();
        if (action.kind === "snooze-default") {
          onActionNow("snooze", defaultSnoozeTs());
        } else if (action.kind === "snapshot-move-lane") {
          onActionNow(action.kind, action.lane);
        } else {
          onActionNow(action.kind);
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // searchRef and undoSlotRef are stable ref objects; the per-selection
    // values are read from handlersRef.current at event time, so the listener
    // is bound exactly once for the hook's lifetime.
  }, [searchRef, undoSlotRef]);
}
