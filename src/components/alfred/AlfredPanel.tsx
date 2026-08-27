// The Alfred Panel (CONTEXT.md): right-docked dashboard chat surface, toggled
// with Cmd/Ctrl+\. Overlays the dashboard without reflowing it. Stays mounted
// while closed so the Alfred Conversation survives close/reopen; cleared only
// by new chat (Cmd/Ctrl+Shift+\ → newChatTick).
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { UIEvent } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import { prepareAlfredEmailContext, releaseAlfredEmailContext } from "../../api";
import useAlfredChat from "./useAlfredChat";
import {
  ALFRED_EMAIL_SUGGESTIONS,
  ALFRED_SUGGESTIONS,
  alfredScrollKey,
  formatAlfredModelHint,
  isNearBottom,
  type AlfredPanelMessage,
} from "./alfredPanelModel";
import {
  ErrorLine,
  NoticeLine,
  SayBlock,
  SuggestionList,
  ToolSteps,
  UserLine,
} from "./AlfredMessages";
import { RowsBlock } from "./AlfredRows";
import AlfredComposer from "./AlfredComposer";
import AlfredEmailPreview from "./AlfredEmailPreview";
import AlfredTransactionBreakdown from "./AlfredTransactionBreakdown";
import AlfredBreakdown from "./AlfredBreakdown";
import AlfredCalendarProposalCard from "./AlfredCalendarProposalCard";
import type { AlfredEmailItem } from "../../../shared/types/alfred";
import type {
  AlfredCalendarProposal,
  AlfredEmailAttachmentRef,
  AlfredEmailContextSource,
} from "../../../shared/types/alfred";
import type { NormalizedCalendarEvent } from "../../../shared/types/calendar";
import type { CalendarOpenRequest } from "../dashboard/dashboardShellModel";
import type { AlfredChipAction } from "./alfredChipActionModel";
import type { AlfredRow } from "./alfredRowOrdering";
import {
  alfredCreatedEventCalendarRequest,
  alfredProposalCalendarRequest,
} from "./alfredCalendarProposalModel";
import {
  emailAttachmentPreviewItem,
  pendingEmailAttachment,
  type AlfredPendingEmailContext,
} from "./alfredEmailContextModel";

const dim = "rgba(205,214,244,0.55)";
const text = "var(--sp-text)";

export interface AlfredPanelProps {
  open: boolean;
  onClose: () => void;
  accent: string;
  handoff: { id: string | number; query: string } | null;
  emailHandoff?: { id: string | number; source: AlfredEmailContextSource } | null;
  newChatTick: number;
  onOpenCalendarItem?: (request: CalendarOpenRequest) => void;
  onReviewCalendarProposal?: (request: CalendarOpenRequest) => void;
}

function AlfredPanel({ open, onClose, accent, handoff, emailHandoff = null, newChatTick, onOpenCalendarItem, onReviewCalendarProposal }: AlfredPanelProps) {
  const {
    messages,
    busy,
    activeModel,
    submit,
    newChat,
    setProposalHandoffError,
    completeProposal,
  } = useAlfredChat();
  const [previewItem, setPreviewItem] = useState<AlfredEmailItem | null>(null);
  const [pendingEmail, setPendingEmailState] = useState<AlfredPendingEmailContext | null>(null);
  const [overflowRecovery, setOverflowRecovery] = useState(false);
  const pendingEmailRef = useRef<AlfredPendingEmailContext | null>(null);
  const prepareAbortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Header-button new-chats bump this; combined with the external newChatTick it
  // forms the composer's clear signal (perf audit fe-alfred::composer-keystroke-
  // rerenders-thread). The draft no longer lives in this component, so the hook's
  // own newChat()→setDraft("") reset can't reach the live input on its own; the
  // composer clears its LOCAL draft whenever this combined signal changes.
  const [headerClearTick, setHeaderClearTick] = useState(0);
  const composerClearSignal = `${newChatTick}:${headerClearTick}`;
  const [previousNewChatTick, setPreviousNewChatTick] = useState(newChatTick);
  if (previousNewChatTick !== newChatTick) {
    setPreviousNewChatTick(newChatTick);
    if (overflowRecovery) setOverflowRecovery(false);
  }
  // P3-4: only follow the tail when the user is parked near the bottom. Starts
  // true so the first answer scrolls into view; flipped by onScroll as the user
  // scrolls up to read earlier messages while composing. A ref (not state) so
  // scroll events don't trigger re-renders.
  const stickToBottomRef = useRef(true);

  const setPendingEmail = useCallback((next: AlfredPendingEmailContext | null) => {
    pendingEmailRef.current = next;
    setPendingEmailState(next);
  }, []);

  const updatePendingEmail = useCallback((
    key: string,
    update: (current: AlfredPendingEmailContext) => AlfredPendingEmailContext,
  ) => {
    setPendingEmailState((current) => {
      if (!current || current.key !== key) return current;
      const next = update(current);
      pendingEmailRef.current = next;
      return next;
    });
  }, []);

  const prepareEmail = useCallback((source: AlfredEmailContextSource, key: string, { replacing = true } = {}) => {
    const previous = pendingEmailRef.current;
    if (replacing && previous?.prepared?.contextId) {
      releaseAlfredEmailContext(previous.prepared.contextId).catch(() => {});
    }
    prepareAbortRef.current?.abort();
    const controller = new AbortController();
    prepareAbortRef.current = controller;
    setOverflowRecovery(false);
    setPendingEmail({ key, source, status: "preparing", prepared: null, error: null });
    prepareAlfredEmailContext(source, { signal: controller.signal })
      .then((prepared) => {
        updatePendingEmail(key, (current) => ({
          ...current,
          status: "ready",
          prepared: {
            ...prepared,
            accountId: current.source.accountId || null,
          },
          error: null,
        }));
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        updatePendingEmail(key, (current) => ({
          ...current,
          status: "error",
          prepared: null,
          error: error instanceof Error ? error.message : "The full email could not be prepared.",
        }));
      });
  }, [setPendingEmail, updatePendingEmail]);

  const removePendingEmail = useCallback(() => {
    prepareAbortRef.current?.abort();
    const current = pendingEmailRef.current;
    if (current?.prepared?.contextId) releaseAlfredEmailContext(current.prepared.contextId).catch(() => {});
    setPendingEmail(null);
    setOverflowRecovery(false);
  }, [setPendingEmail]);

  const retryPendingEmail = useCallback(() => {
    const current = pendingEmailRef.current;
    if (!current) return;
    prepareEmail(current.source, current.key, { replacing: false });
  }, [prepareEmail]);

  // Closing the panel also closes the email preview. React's documented
  // "adjust state when a prop changes" render-phase pattern (store previous
  // open in state + compare) rather than an effect: the preview is a fixed,
  // body-portaled overlay, so a stale previewItem would linger on screen after
  // close. This commits in the same render pass — no extra paint, and it avoids
  // the setState-in-effect cascade lint flags on effect-based resets.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open && previewItem !== null) setPreviewItem(null);
  }

  // Auto-scroll keys on the message list and only follows the tail when the user
  // is near the bottom (was: every render → every keystroke snapped to bottom).
  // Keep scrolled to the newest message (handoff: scrollTop, not scrollIntoView),
  // but only on new/changed messages and only when the user hasn't scrolled up.
  const scrollKey = alfredScrollKey(messages);
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollKey]);

  // Track whether the thread is parked near the bottom (P3-4). Updated on every
  // scroll; gates the auto-scroll effect above so reading earlier messages
  // mid-stream isn't yanked back down.
  function onThreadScroll(e: UIEvent<HTMLDivElement>): void {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    stickToBottomRef.current = isNearBottom(scrollTop, clientHeight, scrollHeight);
  }

  // Header-button new chat (event handler, not render/effect): run the hook's full
  // reset and bump headerClearTick so the composer drops its local draft. The
  // ⌘⇧\ path clears the composer via newChatTick flowing into composerClearSignal.
  const handleHeaderNewChat = useCallback(() => {
    newChat();
    setOverflowRecovery(false);
    setHeaderClearTick((t) => t + 1);
  }, [newChat]);

  const handleRecoveryNewChat = useCallback(() => {
    newChat();
    setOverflowRecovery(false);
  }, [newChat]);

  // ⌘⇧\ new chat. newChat() owns the full reset (messages, draft, abort,
  // server delete) — external work that must stay in an effect, not render. The
  // composer's draft clear rides on newChatTick via composerClearSignal, so this
  // effect stays a single external-system call with no setState.
  const newChatSeen = useRef(newChatTick);
  useEffect(() => {
    if (newChatSeen.current !== newChatTick) {
      newChatSeen.current = newChatTick;
      newChat();
    }
  }, [newChatTick, newChat]);

  // inbox handoff: run the query immediately (CONTEXT.md: no confirmation step)
  const handoffSeen = useRef<string | number | null>(null);
  useEffect(() => {
    // Don't consume the handoff while a run is in flight — submit would no-op on
    // busyRef and the query would be silently lost. Depending on `busy` re-runs
    // this when the current run finishes, so the dropped handoff fires then.
    if (handoff && handoff.id !== handoffSeen.current && !busy) {
      handoffSeen.current = handoff.id;
      submit(handoff.query);
    }
  }, [handoff, submit, busy]);

  const emailHandoffSeen = useRef<string | number | null>(null);
  useEffect(() => {
    if (!emailHandoff || emailHandoff.id === emailHandoffSeen.current) return;
    const timer = window.setTimeout(() => {
      emailHandoffSeen.current = emailHandoff.id;
      prepareEmail(emailHandoff.source, `email-handoff:${emailHandoff.id}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [emailHandoff, prepareEmail]);

  // The panel owns Esc ordering for its overlay stack: preview first, panel
  // second. Document capture + consume, so the calendar's own capture-phase
  // hotkeys (and anything beneath) never see an Esc that Alfred handled.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (previewItem) setPreviewItem(null);
      else onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, previewItem, onClose]);

  // useCallback so RowsBlock (React.memo'd) can bail during token streaming
  // (perf audit fe-alfred::rows-chip-action-rebuilt-every-render). setPreviewItem
  // is stable; onOpenCalendarItem comes from DashboardShell and is stabilized on
  // that island (fe-alfred::unstable-callbacks-from-dashboardshell).
  const onActivateChip = useCallback((action: AlfredChipAction) => {
    if (action.type === "email") {
      setPreviewItem(action.item);
    } else if (action.type === "calendar") {
      setPreviewItem(null);
      onOpenCalendarItem?.(action.request);
    }
  }, [onOpenCalendarItem]);

  const onPreviewAttachment = useCallback((attachment: AlfredEmailAttachmentRef) => {
    setPreviewItem(emailAttachmentPreviewItem(attachment));
  }, []);

  const reviewCalendarProposal = useCallback((proposal: AlfredCalendarProposal) => (
    new Promise<boolean>((resolve) => {
      if (!onReviewCalendarProposal) {
        setProposalHandoffError(proposal.id, "Calendar could not open this proposal. Try again.");
        resolve(false);
        return;
      }
      setProposalHandoffError(proposal.id, null);
      const request = alfredProposalCalendarRequest(proposal, {
        onAcknowledged: (acknowledgement) => {
          if (acknowledgement.status === "accepted") {
            onClose();
            resolve(true);
            return;
          }
          setProposalHandoffError(proposal.id, "Calendar could not open this proposal. Try again.");
          resolve(false);
        },
        onCompleted: (completion) => {
          completeProposal(proposal.id, completion.event);
        },
      });
      onReviewCalendarProposal(request);
    })
  ), [completeProposal, onClose, onReviewCalendarProposal, setProposalHandoffError]);

  const openCreatedEvent = useCallback((event: NormalizedCalendarEvent) => {
    onOpenCalendarItem?.(alfredCreatedEventCalendarRequest(event));
  }, [onOpenCalendarItem]);

  const previewPendingEmail = useCallback(() => {
    const current = pendingEmailRef.current;
    if (current) setPreviewItem(emailAttachmentPreviewItem(pendingEmailAttachment(current)));
  }, []);

  const handleComposerSubmit = useCallback(async (message: string) => {
    const captured = pendingEmailRef.current;
    if (captured && (captured.status !== "ready" || !captured.prepared)) return { status: "ignored" as const };
    const prepared = captured?.prepared || null;
    if (prepared) setPendingEmail(null);
    setOverflowRecovery(false);
    const result = await submit(message, prepared);
    if (result.status !== "error" || !captured || !prepared) return result;

    prepareAbortRef.current?.abort();
    const stagedDuringRun = pendingEmailRef.current;
    if (stagedDuringRun?.prepared?.contextId) {
      releaseAlfredEmailContext(stagedDuringRun.prepared.contextId).catch(() => {});
    }
    const expired = result.code === "email_context_expired";
    setPendingEmail({
      ...captured,
      key: `restored:${prepared.contextId}`,
      status: expired ? "error" : "ready",
      prepared: expired ? null : prepared,
      error: expired ? result.message : null,
    });
    setOverflowRecovery(result.code === "context_window_exceeded");
    return result;
  }, [setPendingEmail, submit]);

  const empty = messages.length === 0;
  const sentEmailCount = messages.filter((message) => message.type === "user" && message.attachment && !message.failed).length;
  const suggestions = pendingEmail
    ? pendingEmail.status === "ready" ? ALFRED_EMAIL_SUGGESTIONS : null
    : ALFRED_SUGGESTIONS;
  const latestProposalReady = [...messages].reverse().find(
    (message): message is Extract<AlfredPanelMessage, { type: "calendar-proposal" }> => (
      message.type === "calendar-proposal" && message.status === "proposed"
    ),
  );

  return createPortal(
    <aside
      aria-hidden={!open}
      inert={!open ? true : undefined}
      aria-label="Alfred panel"
      data-suspend-calendar-hotkeys="all"
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: "min(420px, calc(100vw - 24px))",
        zIndex: 60, display: "flex", flexDirection: "column",
        background: "var(--sp-panel)",
        borderLeft: "1px solid rgba(255,255,255,0.1)",
        boxShadow: open ? "-24px 0 60px rgba(0,0,0,0.55)" : "none",
        transform: open ? "translateX(0)" : "translateX(calc(100% + 40px))",
        transition: "transform 240ms cubic-bezier(0.16,1,0.3,1), box-shadow 240ms ease-out",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <style>{`
        @keyframes alfred-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes alfred-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        @keyframes alfred-bar-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .alfred-bar-grow { animation: alfred-bar-grow 600ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        @keyframes alfred-context-in { from { opacity: 0.7; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
        .alfred-context-enter { animation: alfred-context-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both; }
        .alfred-context-spinner { animation: alfred-spin 1s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .alfred-bar-grow, .alfred-context-enter, .alfred-context-spinner { animation: none; }
        }
      `}</style>

      {/* header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 9, padding: "12px 14px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: 999, background: accent, flexShrink: 0,
          boxShadow: busy ? `0 0 6px ${accent}` : "none",
          animation: busy ? "alfred-pulse 1.4s ease-in-out infinite" : "none",
        }} />
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2.2, textTransform: "uppercase", color: "var(--color-text-faint)" }}>
          Alfred
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" title="New chat (⌘⇧\)" onClick={handleHeaderNewChat}
          aria-label="Start a new Alfred chat"
          className="transition-[background-color,color,transform] duration-150 hover:-translate-y-px hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 active:bg-white/[0.07] motion-reduce:transition-none motion-reduce:transform-none"
          style={{ display: "inline-flex", padding: "4px 7px", background: "transparent", border: "none", cursor: "pointer", color: dim, borderRadius: 6 }}>
          <RotateCcw size={11} />
        </button>
        <button type="button" title="Close (esc)" onClick={onClose}
          aria-label="Close Alfred"
          className="transition-[background-color,color,transform] duration-150 hover:-translate-y-px hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 active:bg-white/[0.07] motion-reduce:transition-none motion-reduce:transform-none"
          style={{ display: "inline-flex", padding: "4px 7px", background: "transparent", border: "none", cursor: "pointer", color: dim, borderRadius: 6 }}>
          <X size={12} />
        </button>
      </div>

      {/* thread */}
      <div ref={scrollerRef} onScroll={onThreadScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 14px 6px" }}>
        {empty ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 26 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.25, color: text }}>
                What do you need?
              </div>
              <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 6, lineHeight: 1.55 }}>
                I can read your calendar, deadlines, bills, and mail, and prepare events for Calendar review.
              </div>
            </div>
            {suggestions ? <div>
              <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 2.2, textTransform: "uppercase", color: "var(--color-text-faint)", marginBottom: 6 }}>Try</div>
              <SuggestionList
                suggestions={suggestions}
                accent={accent}
                onPick={(label: string) => { void handleComposerSubmit(label); }}
              />
            </div> : null}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((m) => {
              if (m.type === "user") return <UserLine key={m.id} text={m.text} accent={accent} attachment={m.attachment} failed={m.failed} onPreviewAttachment={onPreviewAttachment} />;
              if (m.type === "notice") return <NoticeLine key={m.id} text={m.text} />;
              if (m.type === "tools") return <ToolSteps key={m.id} tools={m.tools} done={m.done} accent={accent} />;
              if (m.type === "say") return <SayBlock key={m.id} text={m.text} done={m.done} preamble={m.preamble} />;
              if (m.type === "rows") return <RowsBlock key={m.id} kind={m.kind} items={m.items as AlfredRow[]} accent={accent} onActivateItem={onActivateChip} />;
              if (m.type === "summary") return <AlfredTransactionBreakdown key={m.id} buckets={m.buckets} period={m.period} group_by={m.group_by} accent={accent} />;
              if (m.type === "breakdown") return <AlfredBreakdown key={m.id} kind={m.kind} title={m.title} caption={m.caption} total={m.total} buckets={m.buckets as Array<{ label: string; count: number; items: AlfredRow[] }>} accent={accent} onActivateItem={onActivateChip} />;
              if (m.type === "calendar-proposal") return (
                <AlfredCalendarProposalCard
                  key={m.id}
                  proposal={m.proposal}
                  status={m.status}
                  handoffError={m.handoffError}
                  createdEvent={m.createdEvent}
                  editedInCalendar={m.editedInCalendar}
                  accent={accent}
                  onReview={() => reviewCalendarProposal(m.proposal)}
                  onOpenEvent={() => { if (m.createdEvent) openCreatedEvent(m.createdEvent); }}
                />
              );
              if (m.type === "error") return <ErrorLine key={m.id} text={m.text} />;
              return null;
            })}
          </div>
        )}
      </div>

      <div aria-live="polite" className="sr-only">
        {latestProposalReady ? <span key={latestProposalReady.proposal.id}>Proposed event ready</span> : null}
      </div>

      {/* composer (extracted: local draft state so keystrokes don't re-render the thread) */}
      <AlfredComposer
        open={open}
        busy={busy}
        accent={accent}
        modelHint={activeModel
          ? formatAlfredModelHint(activeModel.provider, activeModel.model)
          : "Settings default"}
        clearSignal={composerClearSignal}
        focusSignal={emailHandoff?.id ?? null}
        pendingEmail={pendingEmail}
        priorEmailCount={sentEmailCount}
        overflowRecovery={overflowRecovery}
        onPreviewEmail={previewPendingEmail}
        onRetryEmail={retryPendingEmail}
        onRemoveEmail={removePendingEmail}
        onStartNewChat={handleHeaderNewChat}
        onRecoverNewChat={handleRecoveryNewChat}
        onSubmit={handleComposerSubmit}
      />

      {previewItem ? (
        <AlfredEmailPreview item={previewItem} onClose={() => setPreviewItem(null)} />
      ) : null}
    </aside>,
    document.body,
  );
}

// React.memo so the panel bails out when DashboardShell passes stable callbacks
// (perf audit fe-alfred::every-token-rerenders-whole-thread /
// fe-alfred::unstable-callbacks-from-dashboardshell). The DashboardShell side
// (stabilizing onClose/onOpenCalendarItem) is owned by the dashboard island; this
// memo is the alfred-side half that lets those stable identities take effect.
export default memo(AlfredPanel);
