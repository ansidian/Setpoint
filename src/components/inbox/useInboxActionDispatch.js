import { useCallback } from "react";
import {
  markEmailAsRead,
  markEmailAsUnread,
  trashEmail,
  trashEmailOnExit,
  snoozeEmail,
  unsnoozeEmail,
  moveSnapshotItemLane,
  dismissSnapshotItemForToday,
  restoreSnapshotItemForToday,
  markSnapshotItemHandled,
  reopenSnapshotItem,
  pinEmail,
  unpinEmail,
} from "../../api";
import { isCatchUpEmail } from "./helpers";
import { pinnedEntryFromSnapshot } from "./inboxWorkItems.js";
import {
  applyLiveTrashOptimistic,
  applySnapshotTrashOptimistic,
  buildTrashCommand,
} from "./inboxCommandModel.js";
import {
  getSnapshotReopenLane,
  isSnapshotDismissibleLane,
  isSnapshotWorkflowLane,
} from "./activeSnapshotWorkflowModel.js";

function formatLaneLabel(lane) {
  if (lane === "needs_attention") return "Needs Attention";
  if (lane === "fyi") return "FYI";
  if (lane === "noise") return "Noise";
  if (lane === "handled") return "Handled";
  return "lane";
}

function buildEmailSnapshot(email) {
  if (!email) return null;
  const account = email._account;
  return {
    uid: email.uid || email.id,
    id: email.id || email.uid,
    subject: email.subject,
    from: email.from,
    fromEmail: email.fromEmail || email.from_email,
    from_email: email.from_email || email.fromEmail,
    preview: email.preview || email.body_preview || "",
    body_preview: email.body_preview || email.preview || "",
    date: email.date,
    read: !!email.read,
    account_id: email.account_id || account?.account_id || account?.id,
    account_email: email.account_email || account?.email,
    account_label: email.account_label || account?.name,
    account_color: email.account_color || account?.color,
    account_icon: email.account_icon || account?.icon,
    urgency: email.urgency,
    hasBill: email.hasBill,
    extractedBill: email.extractedBill,
    claude: email.claude,
    aiSummary: email.aiSummary,
  };
}

// Command builders for the four active-snapshot mutations. Each returns the
// pieces the shared executor needs: the optimistic overlay to paint, the API
// call to commit, the undo description, and whether selection advances after
// dispatch. Returning null means the action is not allowed for this row.
const snapshotCommandBuilders = {
  "snapshot-move-lane": (email, payload) => {
    if (!isSnapshotWorkflowLane(email) || email._lane === "handled") return null;
    const previousLane = email._lane === "carryover" ? "needs_attention" : email._lane;
    return {
      overlay: { laneOverride: payload, hidden: false, pendingAction: "move-lane" },
      run: () => moveSnapshotItemLane(email.snapshot_item_id, payload),
      message: `Moved to ${formatLaneLabel(payload)}`,
      advanceAfter: false,
      undo: {
        skip: !previousLane || previousLane === payload,
        run: () => moveSnapshotItemLane(email.snapshot_item_id, previousLane),
        overlay: {
          laneOverride: previousLane,
          hidden: false,
          pendingAction: "undo-move-lane",
          pending: false,
        },
      },
    };
  },
  "snapshot-dismiss": (email) => {
    if (!isSnapshotDismissibleLane(email)) return null;
    return {
      overlay: { hidden: true, pendingAction: "dismiss" },
      run: () => dismissSnapshotItemForToday(email.snapshot_item_id),
      message: "Email dismissed",
      advanceAfter: true,
      undo: {
        run: () => restoreSnapshotItemForToday(email.snapshot_item_id),
        removeOverlay: true,
      },
    };
  },
  "snapshot-handled": (email) => {
    if (!isSnapshotWorkflowLane(email) || email._lane === "handled") return null;
    const restoreLane = getSnapshotReopenLane(email);
    return {
      overlay: {
        hidden: false,
        laneOverride: "handled",
        handledAt: new Date().toISOString(),
        statusOverride: "handled",
        pendingAction: "handled",
      },
      run: () => markSnapshotItemHandled(email.snapshot_item_id),
      message: "Marked handled",
      advanceAfter: true,
      undo: {
        run: () => reopenSnapshotItem(email.snapshot_item_id),
        overlay: {
          hidden: false,
          laneOverride: restoreLane,
          handledAt: null,
          statusOverride: null,
          pendingAction: "undo-handled",
          pending: false,
        },
      },
    };
  },
  "snapshot-reopen": (email) => {
    const restoreLane = getSnapshotReopenLane(email);
    return {
      overlay: {
        hidden: false,
        laneOverride: restoreLane,
        handledAt: null,
        statusOverride: null,
        pendingAction: "reopen",
      },
      run: () => reopenSnapshotItem(email.snapshot_item_id),
      message: "Email reopened",
      advanceAfter: false,
      undo: {
        run: () => markSnapshotItemHandled(email.snapshot_item_id),
        overlay: {
          hidden: false,
          laneOverride: "handled",
          handledAt: email.handled_at || new Date().toISOString(),
          statusOverride: "handled",
          pendingAction: "undo-reopen",
          pending: false,
        },
      },
    };
  },
};

export default function useInboxActionDispatch({
  selectedEmail,
  readOnly = false,
  moveBy,
  onLiveReadOverrideChange,
  closeSelectedEmail,
  updateIndexedSearchRead,
  onActiveSnapshotRefresh,
  replaceUndoSlot,
  setSelectedId,
  setLiveTrashedUids,
  setSnapshotOptimistic,
  setSnoozedMap,
  setPinnedOverrides,
  snapshotPendingRef,
  snapshotRequestRef,
}) {
  const runSnapshotCommand = useCallback((kind, email, payload) => {
    if (isCatchUpEmail(email)) return;
    if (readOnly) return;
    if (!email._activeSnapshot || !email.snapshot_item_id) return;
    const command = snapshotCommandBuilders[kind](email, payload);
    if (!command) return;

    const itemId = String(email.snapshot_item_id);
    if (snapshotPendingRef.current.has(itemId)) return;
    const restoreSelectedId = email.id || email.uid;
    const requestToken = ++snapshotRequestRef.current;
    snapshotPendingRef.current.add(itemId);
    setSnapshotOptimistic((prev) => {
      const next = new Map(prev);
      next.set(itemId, {
        ...(prev.get(itemId) || {}),
        ...command.overlay,
        pending: true,
        requestToken,
      });
      return next;
    });
    command.run()
      .then(() => onActiveSnapshotRefresh())
      .then(() => {
        snapshotPendingRef.current.delete(itemId);
        setSnapshotOptimistic((prev) => {
          const current = prev.get(itemId);
          if (!current || current.requestToken !== requestToken) return prev;
          const next = new Map(prev);
          next.set(itemId, { ...current, pending: false });
          return next;
        });
      })
      .catch(() => {
        snapshotPendingRef.current.delete(itemId);
        setSnapshotOptimistic((prev) => {
          const current = prev.get(itemId);
          if (!current || current.requestToken !== requestToken) return prev;
          const next = new Map(prev);
          next.delete(itemId);
          return next;
        });
        onActiveSnapshotRefresh();
      });
    replaceUndoSlot({
      type: kind,
      message: command.message,
      undo: async () => {
        if (command.undo.skip) return;
        await command.undo.run();
        setSnapshotOptimistic((prev) => {
          const next = new Map(prev);
          if (command.undo.removeOverlay) {
            next.delete(itemId);
          } else {
            next.set(itemId, {
              ...(prev.get(itemId) || {}),
              ...command.undo.overlay,
            });
          }
          return next;
        });
        setSelectedId(restoreSelectedId);
        await onActiveSnapshotRefresh();
      },
    });
    if (command.advanceAfter) moveBy(1);
  }, [
    readOnly,
    moveBy,
    onActiveSnapshotRefresh,
    replaceUndoSlot,
    setSelectedId,
    setSnapshotOptimistic,
    snapshotPendingRef,
    snapshotRequestRef,
  ]);

  return useCallback((kind, payload) => {
    if (!selectedEmail) return;

    const id = selectedEmail.id;
    const uid = selectedEmail.uid || id;
    const catchUpSelected = isCatchUpEmail(selectedEmail);
    if (kind === "next") {
      moveBy(1);
      return;
    }

    if (kind === "prev") {
      moveBy(-1);
      return;
    }

    if (kind === "pin-toggle") {
      const wasPinned = !!selectedEmail._pinned;
      const entry = wasPinned
        ? null
        : pinnedEntryFromSnapshot(uid, Date.now(), buildEmailSnapshot(selectedEmail));
      setPinnedOverrides((prev) => {
        const next = new Map(prev);
        next.set(uid, { pinned: !wasPinned, entry });
        return next;
      });
      const rollback = () => setPinnedOverrides((prev) => {
        if (!prev.has(uid)) return prev;
        const next = new Map(prev);
        next.delete(uid);
        return next;
      });
      const call = wasPinned
        ? unpinEmail(uid)
        : pinEmail(uid, buildEmailSnapshot(selectedEmail));
      call.then(() => onActiveSnapshotRefresh()).catch(rollback);
      replaceUndoSlot({
        type: "pin-toggle",
        message: wasPinned ? "Email unpinned" : "Email pinned",
        undo: async () => {
          await (wasPinned
            ? pinEmail(uid, buildEmailSnapshot(selectedEmail))
            : unpinEmail(uid)).catch(() => {});
          rollback();
          await onActiveSnapshotRefresh();
        },
      });
      return;
    }

    if (kind === "trash") {
      const command = buildTrashCommand(selectedEmail, { readOnly });
      if (!command.allowed) return;
      if (command.scope === "live") {
        setLiveTrashedUids((prev) => applyLiveTrashOptimistic(prev, command.uid, true));
        replaceUndoSlot({
          type: "trash",
          message: "Email moved to trash",
          commit: async () => {
            await trashEmail(command.uid);
            await onActiveSnapshotRefresh();
          },
          commitOnExit: () => trashEmailOnExit(command.uid),
          undo: async () => {
            setLiveTrashedUids((prev) => applyLiveTrashOptimistic(prev, command.uid, false));
            setSelectedId(command.restoreSelectedId);
          },
        });
      } else if (command.scope === "activeSnapshot") {
        if (command.itemId) setSnapshotOptimistic((prev) => applySnapshotTrashOptimistic(prev, command.itemId, true));
        replaceUndoSlot({
          type: "trash",
          message: "Email moved to trash",
          commit: async () => {
            await trashEmail(command.uid);
            await onActiveSnapshotRefresh();
          },
          commitOnExit: () => trashEmailOnExit(command.uid),
          undo: async () => {
            if (command.itemId) setSnapshotOptimistic((prev) => applySnapshotTrashOptimistic(prev, command.itemId, false));
            setSelectedId(command.restoreSelectedId);
          },
        });
      } else {
        replaceUndoSlot({
          type: "trash",
          message: "Email moved to trash",
          commit: async () => {
            await trashEmail(command.uid);
          },
          commitOnExit: () => trashEmailOnExit(command.uid),
          undo: async () => {
            setSelectedId(command.restoreSelectedId);
          },
        });
      }

      setSnoozedMap((prev) => {
        if (!prev.has(uid)) return prev;
        const next = new Map(prev);
        next.delete(uid);
        return next;
      });

      moveBy(1);
      return;
    }

    if (kind in snapshotCommandBuilders) {
      runSnapshotCommand(kind, selectedEmail, payload);
      return;
    }

    if (kind === "snooze") {
      if (catchUpSelected) return;
      if (readOnly) return;
      const untilTs = Number(payload);
      if (!Number.isFinite(untilTs) || untilTs <= Date.now()) return;
      setSnoozedMap((prev) => {
        const next = new Map(prev);
        next.set(uid, untilTs);
        return next;
      });
      const snapshot = buildEmailSnapshot(selectedEmail);
      const restoreSelectedId = id || uid;
      const snoozePromise = snoozeEmail(uid, untilTs, snapshot).catch((err) => {
        setSnoozedMap((prev) => {
          const next = new Map(prev);
          next.delete(uid);
          return next;
        });
        throw err;
      });
      snoozePromise.catch(() => {});
      replaceUndoSlot({
        type: "snooze",
        message: "Email snoozed",
        undo: async () => {
          await snoozePromise.catch(() => {});
          await unsnoozeEmail(uid);
          setSnoozedMap((prev) => {
            const next = new Map(prev);
            next.delete(uid);
            return next;
          });
          setSelectedId(restoreSelectedId);
          await onActiveSnapshotRefresh();
        },
      });
      moveBy(1);
      return;
    }

    if (kind === "toggle-read") {
      if (readOnly) return;
      const markingUnread = !!selectedEmail.read;
      if (selectedEmail._live || selectedEmail._activeSnapshot) {
        onLiveReadOverrideChange(uid, !markingUnread);
      }
      const call = markingUnread ? markEmailAsUnread : markEmailAsRead;
      call(uid).catch(() => {});
      updateIndexedSearchRead(uid, !markingUnread);
      if (markingUnread) closeSelectedEmail();
      return;
    }

  }, [
    selectedEmail,
    readOnly,
    moveBy,
    onLiveReadOverrideChange,
    closeSelectedEmail,
    updateIndexedSearchRead,
    onActiveSnapshotRefresh,
    replaceUndoSlot,
    setSelectedId,
    setLiveTrashedUids,
    setSnapshotOptimistic,
    setSnoozedMap,
    setPinnedOverrides,
    runSnapshotCommand,
  ]);
}
