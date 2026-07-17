import { useEffect, useMemo, useRef, useState } from "react";
import AddTaskPanel from "../../todoist/AddTaskPanel";
import { useOptionalDashboard } from "../../../context/DashboardContext";
import { buildRemindMeTaskSeed } from "./remindMeTaskSeedModel";
import type { DashboardDeadline } from "../../../context/dashboardTaskProjection";
import DesktopReader from "./DesktopReader";
import MobileReader from "./MobileReader";
import { ReaderEmptyState } from "./ReaderShared";
import useEmailBody from "./useEmailBody";
import useBillPayResolver from "./useBillPayResolver";
import type { Dispatch, SetStateAction } from "react";
import type { InboxAccount, InboxEmailLike } from "../inboxTypes";
import type { InboxActionDispatcher } from "../useInboxActionDispatch";

export default function Reader({
  email,
  account,
  accent,
  onAction,
  onClose,
  onRemind,
  onAskAlfred,
  showTriage,
  showDraft,
  billOpen,
  setBillOpen,
  onOpenRecordedBill,
  isMobile = false,
  readOnly = false,
  onWorkspaceDirtyChange,
}: {
  email: InboxEmailLike | null;
  account?: InboxAccount | null;
  accent: string;
  onAction: InboxActionDispatcher;
  onClose: () => void;
  onRemind?: () => void;
  onAskAlfred?: () => void;
  showTriage: boolean;
  showDraft: boolean;
  billOpen: boolean;
  setBillOpen: Dispatch<SetStateAction<boolean>>;
  onOpenRecordedBill?: (target: { date: string; itemId: string }) => void;
  isMobile?: boolean;
  readOnly?: boolean;
  onWorkspaceDirtyChange?: (dirty: boolean) => void;
}) {
  const snoozeBtnRef = useRef<HTMLButtonElement>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [drafting, setDrafting] = useState(showDraft);
  const [billMounted, setBillMounted] = useState(billOpen);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskDirty, setTaskDirty] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const dashboard = useOptionalDashboard();
  const seed = useMemo(() => email ? buildRemindMeTaskSeed(email) : null, [email]);
  const bodyState = useEmailBody(email);
  const billResolution = useBillPayResolver({ email, billOpen, bodyState });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (billOpen) setBillMounted(true);
  }, [billOpen]);

  useEffect(() => onWorkspaceDirtyChange?.(taskDirty || draftDirty), [draftDirty, onWorkspaceDirtyChange, taskDirty]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!email) return <ReaderEmptyState />;

  const confirmDiscard = (dirty: boolean) => !dirty || window.confirm("Discard your unsaved changes?");
  const closeTask = () => {
    setTaskOpen(false);
    setTaskDirty(false);
  };
  const openTask = () => {
    if (drafting && !confirmDiscard(draftDirty)) return;
    setBillOpen(false);
    setDrafting(false);
    setDraftDirty(false);
    setTaskOpen(true);
  };
  const guardedSetBillOpen: Dispatch<SetStateAction<boolean>> = (update) => {
    const next = typeof update === "function" ? update(billOpen) : update;
    if (next && taskOpen && !confirmDiscard(taskDirty)) return;
    if (next && drafting && !confirmDiscard(draftDirty)) return;
    if (next) { setTaskOpen(false); setTaskDirty(false); setDrafting(false); setDraftDirty(false); }
    setBillOpen(next);
  };
  const guardedSetDrafting: Dispatch<SetStateAction<boolean>> = (update) => {
    const next = typeof update === "function" ? update(drafting) : update;
    if (next && taskOpen && !confirmDiscard(taskDirty)) return;
    if (!next && drafting && draftDirty && !confirmDiscard(true)) return;
    if (next) { setTaskOpen(false); setTaskDirty(false); setBillOpen(false); }
    setDrafting(next);
  };
  const taskPanel = taskOpen ? (
    <AddTaskPanel
      key={String(email.id || email.uid)}
      host={isMobile ? "floating" : "inline"}
      initialInput={seed!.title}
      initialDescription={seed!.description}
      descriptionVariant="email-context"
      confirmDirtyCloseInline
      initialDueEpochMs={seed!.dueEpochMs}
      requireDue
      requiredDescriptionSuffix={!seed!.triaged && seed!.sourceUrl ? `Source: ${seed!.sourceUrl}` : null}
      supportingContext={seed!.detectedDateLabel ? `Detected source date: ${seed!.detectedDateLabel}` : "Choose a due date to save"}
      onDirtyChange={setTaskDirty}
      onClose={closeTask}
      onTaskAdded={(task) => {
        dashboard?.handleAddTask(task as DashboardDeadline);
        setTaskOpen(false);
        setTaskDirty(false);
        setToast("Reminder added");
      }}
    />
  ) : null;

  const sharedProps = {
    email,
    account,
    accent,
    onAction,
    onClose,
    onRemind: onRemind || openTask,
    onAskAlfred,
    showTriage,
    showDraft: false,
    billOpen,
    setBillOpen: guardedSetBillOpen,
    onOpenRecordedBill,
    snoozeBtnRef,
    snoozeOpen,
    setSnoozeOpen,
    bodyState,
    billResolution,
    drafting,
    setDrafting: guardedSetDrafting,
    setDraftDirty,
    taskWorkspace: isMobile ? null : taskPanel,
    readOnly,
  };

  return <>
    {isMobile ? <MobileReader {...sharedProps} /> : <DesktopReader {...sharedProps} billMounted={billMounted} />}
    {isMobile ? taskPanel : null}
    {toast && <div role="status" style={{ position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", zIndex: 10000, padding: "9px 14px", borderRadius: 10, background: "var(--sp-panel)", color: "var(--sp-green)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 20px 60px rgba(0,0,0,0.55)" }}>{toast}</div>}
  </>;
}
