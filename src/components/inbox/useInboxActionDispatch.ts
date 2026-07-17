import { useCallback, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PinnedEmailSnapshot } from "../../../shared/types/email";
import type { SnapshotTriageLane } from "../../../shared/types/snapshots";
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
import { pinnedEntryFromSnapshot } from "./inboxWorkItems";
import {
  applyLiveTrashOptimistic,
  applySnapshotTrashOptimistic,
  buildTrashCommand,
} from "./inboxCommandModel";
import {
  getSnapshotReopenLane,
  isSnapshotDismissibleLane,
  isSnapshotWorkflowLane,
} from "./activeSnapshotWorkflowModel";
import type {
  InboxEmailLike,
  InboxId,
  InboxPinnedOverride,
  SnapshotOptimisticOverlay,
} from "./inboxTypes";
import type { InboxUndoController } from "./useInboxUndoSlot";

type SnapshotActionKind = "snapshot-move-lane" | "snapshot-dismiss" | "snapshot-handled" | "snapshot-reopen";
export type InboxActionKind = SnapshotActionKind | "next" | "prev" | "pin-toggle" | "trash" | "snooze" | "toggle-read";
export type InboxActionDispatcher = (kind: InboxActionKind, payload?: SnapshotTriageLane | number) => void;

type SnapshotOverlayMap = Map<string, SnapshotOptimisticOverlay>;

interface SnapshotUndoCommand {
  skip?: boolean;
  run: () => Promise<unknown>;
  removeOverlay?: boolean;
  overlay?: SnapshotOptimisticOverlay;
}

interface SnapshotCommand {
  overlay: SnapshotOptimisticOverlay;
  run: () => Promise<unknown>;
  message: string;
  advanceAfter: boolean;
  undo: SnapshotUndoCommand;
}

export interface InboxActionDispatchOptions {
  selectedEmail: InboxEmailLike | null;
  readOnly?: boolean;
  moveBy: (direction: number) => void;
  onLiveReadOverrideChange: (uid: string, read: boolean) => void;
  closeSelectedEmail: () => void;
  updateIndexedSearchRead: (uid: string, read: boolean) => void;
  onActiveSnapshotRefresh: () => unknown | Promise<unknown>;
  replaceUndoSlot: InboxUndoController["replaceUndoSlot"];
  setSelectedId: Dispatch<SetStateAction<InboxId | null>>;
  setLiveTrashedUids: Dispatch<SetStateAction<Set<string>>>;
  setSnapshotOptimistic: Dispatch<SetStateAction<SnapshotOverlayMap>>;
  setSnoozedMap: Dispatch<SetStateAction<Map<string, number>>>;
  setPinnedOverrides: Dispatch<SetStateAction<Map<string, InboxPinnedOverride>>>;
  snapshotPendingRef: MutableRefObject<Set<string>>;
  snapshotRequestRef: MutableRefObject<number>;
}

function formatLaneLabel(lane: SnapshotTriageLane) {
  if (lane === "needs_attention") return "Needs Attention";
  if (lane === "fyi") return "FYI";
  if (lane === "noise") return "Noise";
  if (lane === "handled") return "Handled";
  return "lane";
}

function buildEmailSnapshot(email: InboxEmailLike | null | undefined): (PinnedEmailSnapshot & InboxEmailLike) | null {
  if (!email) return null;
  const account = email._account;
  return {
    uid: String(email.uid || email.id || ""),
    id: email.id || email.uid || "",
    subject: email.subject || "",
    from: email.from || "",
    fromEmail: email.fromEmail || email.from_email || "",
    from_email: email.from_email || email.fromEmail || "",
    preview: email.preview || email.body_preview || "",
    body_preview: email.body_preview || email.preview || "",
    date: email.date,
    read: !!email.read,
    account_id: email.account_id || account?.account_id || account?.id || null,
    account_email: email.account_email || account?.email || null,
    account_label: email.account_label || account?.name || null,
    account_color: email.account_color || account?.color || null,
    account_icon: email.account_icon || account?.icon || null,
    urgency: email.urgency || null,
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
const snapshotCommandBuilders: Record<SnapshotActionKind, (email: InboxEmailLike, payload?: SnapshotTriageLane) => SnapshotCommand | null> = {
  "snapshot-move-lane": (email, payload) => {
    if (!payload) return null;
    if (!isSnapshotWorkflowLane(email) || email._lane === "handled") return null;
    const itemId = email.snapshot_item_id;
    if (itemId == null) return null;
    const previousLane = (email._lane === "carryover" ? "needs_attention" : email._lane) as SnapshotTriageLane | null;
    return {
      overlay: { laneOverride: payload, hidden: false, pendingAction: "move-lane" },
      run: () => moveSnapshotItemLane(itemId, payload),
      message: `Moved to ${formatLaneLabel(payload)}`,
      advanceAfter: false,
      undo: {
        skip: !previousLane || previousLane === payload,
        run: () => previousLane ? moveSnapshotItemLane(itemId, previousLane) : Promise.resolve(),
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
    const itemId = email.snapshot_item_id;
    if (itemId == null) return null;
    return {
      overlay: { hidden: true, pendingAction: "dismiss" },
      run: () => dismissSnapshotItemForToday(itemId),
      message: "Email dismissed",
      advanceAfter: true,
      undo: {
        run: () => restoreSnapshotItemForToday(itemId),
        removeOverlay: true,
      },
    };
  },
  "snapshot-handled": (email) => {
    if (!isSnapshotWorkflowLane(email) || email._lane === "handled") return null;
    const itemId = email.snapshot_item_id;
    if (itemId == null) return null;
    const restoreLane = getSnapshotReopenLane(email);
    return {
      overlay: {
        hidden: false,
        laneOverride: "handled",
        handledAt: new Date().toISOString(),
        statusOverride: "handled",
        pendingAction: "handled",
      },
      run: () => markSnapshotItemHandled(itemId),
      message: "Marked handled",
      advanceAfter: true,
      undo: {
        run: () => reopenSnapshotItem(itemId),
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
    const itemId = email.snapshot_item_id;
    if (itemId == null) return null;
    const restoreLane = getSnapshotReopenLane(email);
    return {
      overlay: {
        hidden: false,
        laneOverride: restoreLane,
        handledAt: null,
        statusOverride: null,
        pendingAction: "reopen",
      },
      run: () => reopenSnapshotItem(itemId),
      message: "Email reopened",
      advanceAfter: false,
      undo: {
        run: () => markSnapshotItemHandled(itemId),
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
}: InboxActionDispatchOptions): { onAction: InboxActionDispatcher; announcement: string } {
  // Screen-reader announcement for the dispatch's silent (non-toast) mutations
  // only. Toast-producing actions already get an aria-live region for free via
  // InboxUndoToast (role="status" aria-live="polite"); this covers the gap —
  // e.g. toggle-read, which never calls replaceUndoSlot.
  const [announcement, setAnnouncement] = useState("");

  // Two consecutive announcements that happen to produce the same string
  // (e.g. "Marked as unread" on email A, then email B) would otherwise hit
  // React's identical-value setState bailout: the DOM text node never
  // actually changes, so most screen readers won't re-announce. Clearing to
  // "" first — on a separate microtask, so it commits as its own render
  // before the real text is set — forces the live region through an
  // empty→text transition every time, regardless of whether the text repeats.
  const announce = useCallback((text: string) => {
    setAnnouncement("");
    queueMicrotask(() => setAnnouncement(text));
  }, []);

  const runSnapshotCommand = useCallback((kind: SnapshotActionKind, email: InboxEmailLike, payload?: SnapshotTriageLane) => {
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
              ...(command.undo.overlay || {}),
            });
          }
          return next;
        });
        setSelectedId(restoreSelectedId ?? null);
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

  const dispatch = useCallback<InboxActionDispatcher>((kind, payload) => {
    if (!selectedEmail) return;

    const id = selectedEmail.id;
    const uidValue = selectedEmail.uid || id;
    if (uidValue == null) return;
    const uid = String(uidValue);
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
        : pinnedEntryFromSnapshot(uid, Date.now(), buildEmailSnapshot(selectedEmail) || {});
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
      const snapshot = buildEmailSnapshot(selectedEmail);
      const call = wasPinned
        ? unpinEmail(uid)
        : pinEmail(uid, snapshot);
      call.then(() => onActiveSnapshotRefresh()).catch(rollback);
      replaceUndoSlot({
        type: "pin-toggle",
        message: wasPinned ? "Email unpinned" : "Email pinned",
        undo: async () => {
          await (wasPinned
            ? pinEmail(uid, snapshot)
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
      if (command.uid == null) return;
      const commandUid = String(command.uid);
      if (command.scope === "live") {
        setLiveTrashedUids((prev) => applyLiveTrashOptimistic(prev, commandUid, true));
        replaceUndoSlot({
          type: "trash",
          message: "Email moved to trash",
          commit: async () => {
            await trashEmail(commandUid);
            await onActiveSnapshotRefresh();
          },
          commitOnExit: () => trashEmailOnExit(commandUid),
          undo: async () => {
            setLiveTrashedUids((prev) => applyLiveTrashOptimistic(prev, commandUid, false));
            setSelectedId(command.restoreSelectedId ?? null);
          },
        });
      } else if (command.scope === "activeSnapshot") {
        if (command.itemId) setSnapshotOptimistic((prev) => new Map(applySnapshotTrashOptimistic(prev, command.itemId, true)));
        replaceUndoSlot({
          type: "trash",
          message: "Email moved to trash",
          commit: async () => {
            await trashEmail(commandUid);
            await onActiveSnapshotRefresh();
          },
          commitOnExit: () => trashEmailOnExit(commandUid),
          undo: async () => {
            if (command.itemId) setSnapshotOptimistic((prev) => new Map(applySnapshotTrashOptimistic(prev, command.itemId, false)));
            setSelectedId(command.restoreSelectedId ?? null);
          },
        });
      } else {
        replaceUndoSlot({
          type: "trash",
          message: "Email moved to trash",
          commit: async () => {
            await trashEmail(commandUid);
          },
          commitOnExit: () => trashEmailOnExit(commandUid),
          undo: async () => {
            setSelectedId(command.restoreSelectedId ?? null);
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
      runSnapshotCommand(kind as SnapshotActionKind, selectedEmail, typeof payload === "string" ? payload : undefined);
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
      call(uid).catch(() => {
        if (selectedEmail._live || selectedEmail._activeSnapshot) {
          onLiveReadOverrideChange(uid, markingUnread);
        }
        updateIndexedSearchRead(uid, markingUnread);
      });
      updateIndexedSearchRead(uid, !markingUnread);
      announce(markingUnread ? "Marked as unread" : "Marked as read");
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
    announce,
  ]);

  return { onAction: dispatch, announcement };
}
