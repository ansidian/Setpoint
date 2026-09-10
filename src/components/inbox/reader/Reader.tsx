import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { buildEmailFinancialProfileSeed } from "../../../lib/financialProfileSeed";
import { motion as Motion, useReducedMotion } from "motion/react";
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
import { motionDuration, motionTransition } from "../../../lib/motion";
import useMotionPresence from "../../../hooks/useMotionPresence";
import useInboxDiscardPrompt from "../useInboxDiscardPrompt";
import type { InboxDiscardRequest } from "../useInboxDiscardPrompt";

export default function Reader({
  email,
  account,
  accent,
  onAction,
  onClose,
  onPrevious,
  onNext,
  backLabel,
  onRemind,
  onAskAlfred,
  showTriage,
  showDraft,
  isMobile = false,
  readOnly = false,
  onWorkspaceDirtyChange,
  onRequestDiscard,
}: {
  email: InboxEmailLike | null;
  account?: InboxAccount | null;
  accent: string;
  onAction: InboxActionDispatcher;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  backLabel?: string;
  onRemind?: () => void;
  onAskAlfred?: () => void;
  showTriage: boolean;
  showDraft: boolean;
  isMobile?: boolean;
  readOnly?: boolean;
  onWorkspaceDirtyChange?: (dirty: boolean) => void;
  onRequestDiscard?: InboxDiscardRequest;
}) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion() ?? false;
  const snoozeBtnRef = useRef<HTMLButtonElement>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [drafting, setDrafting] = useState(isMobile ? false : showDraft);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskDirty, setTaskDirty] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const taskPresence = useMotionPresence(taskOpen, reduceMotion ? 0 : motionDuration.exit * 1000);
  const taskMounted = taskOpen || taskPresence;
  const toastRendered = useMotionPresence(Boolean(toast), reduceMotion ? 0 : motionDuration.exit * 1000);
  const dashboard = useOptionalDashboard();
  const seed = useMemo(() => email ? buildRemindMeTaskSeed(email) : null, [email]);
  const bodyState = useEmailBody(email);
  const billResolution = useBillPayResolver({ email, bodyState });
  const localDiscardPrompt = useInboxDiscardPrompt(`${email?.account_id || email?.accountId || ""}:${email?.uid || email?.email_id || email?.id || ""}`);
  const requestDiscard = onRequestDiscard || localDiscardPrompt.requestDiscard;

  useEffect(() => onWorkspaceDirtyChange?.(taskDirty || draftDirty), [draftDirty, onWorkspaceDirtyChange, taskDirty]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => () => {
    // The Inbox is Activity-hidden rather than unmounted on a tab change.
    // Dismiss this action confirmation on leave instead of restoring stale
    // feedback and restarting its timer when the user returns.
    setToast(null);
  }, []);

  if (!email) return <ReaderEmptyState />;

  const afterDiscard = (dirty: boolean, action: () => void) => { if (requestDiscard(dirty, action)) action(); };
  const closeTask = () => {
    setTaskOpen(false);
    setTaskDirty(false);
  };
  const openTask = () => {
    afterDiscard(drafting && draftDirty, () => {
      setDrafting(false);
      setDraftDirty(false);
      setTaskOpen(true);
    });
  };
  const toggleTask = () => {
    if (!taskOpen) {
      openTask();
      return;
    }
    afterDiscard(taskDirty, closeTask);
  };
  const createProfile = () => {
    afterDiscard(taskDirty || draftDirty, () => {
      closeTask();
      setDrafting(false);
      setDraftDirty(false);
      const financialProfileSeed = buildEmailFinancialProfileSeed(email, { body: bodyState.body, resolution: billResolution });
      void navigate("/settings?tab=finance", { state: { financialProfileSeed } });
    });
  };
  const guardedSetDrafting: Dispatch<SetStateAction<boolean>> = (update) => {
    const next = typeof update === "function" ? update(drafting) : update;
    afterDiscard(next ? taskOpen && taskDirty : drafting && draftDirty, () => {
      if (next) { setTaskOpen(false); setTaskDirty(false); }
      if (!next) setDraftDirty(false);
      setDrafting(next);
    });
  };
  const taskPanel = taskMounted ? (
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
    onPrevious,
    onNext,
    backLabel,
    onRemind: onRemind || toggleTask,
    onAskAlfred,
    showTriage,
    showDraft: false,
    onCreateProfile: createProfile,
    snoozeBtnRef,
    snoozeOpen,
    setSnoozeOpen,
    bodyState,
    billResolution,
    drafting,
    setDrafting: guardedSetDrafting,
    setDraftDirty,
    taskWorkspace: isMobile ? null : taskPanel,
    taskOpen,
    readOnly,
  };

  return <>
    {isMobile ? <MobileReader {...sharedProps} /> : <DesktopReader {...sharedProps} />}
    {isMobile && taskOpen ? taskPanel : null}
    {localDiscardPrompt.dialog}
      {toastRendered && (
        <Motion.div
          key="reminder-toast"
          role={toast ? "status" : undefined}
          aria-hidden={!toast}
          inert={!toast ? true : undefined}
          initial={reduceMotion ? false : { opacity: 0, x: "-50%", y: 8 }}
          animate={{ opacity: toast ? 1 : 0, x: "-50%", y: toast || reduceMotion ? 0 : 6 }}
          transition={motionTransition(reduceMotion, motionDuration.exit)}
          style={{ position: "fixed", left: "50%", bottom: 20, zIndex: 10000, padding: "9px 14px", borderRadius: 10, background: "var(--sp-panel)", color: "var(--sp-green)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 20px 60px rgba(0,0,0,0.55)" }}
        >
          {toast || ""}
        </Motion.div>
      )}
  </>;
}
