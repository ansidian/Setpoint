// The Alfred Panel (CONTEXT.md): right-docked dashboard chat surface, toggled
// with Cmd/Ctrl+\. Overlays the dashboard without reflowing it. Stays mounted
// while closed so the Alfred Conversation survives close/reopen; cleared only
// by new chat (Cmd/Ctrl+Shift+\ → newChatTick).
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { UIEvent } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import useAlfredChat from "./useAlfredChat";
import { alfredScrollKey, formatAlfredModelHint, isNearBottom } from "./alfredPanelModel";
import {
  ErrorLine,
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
import type { AlfredEmailItem } from "../../../shared/types/alfred";
import type { CalendarOpenRequest } from "../dashboard/dashboardShellModel";
import type { AlfredChipAction } from "./alfredChipActionModel";
import type { AlfredRow } from "./alfredRowOrdering";

const dim = "rgba(205,214,244,0.55)";
const text = "var(--sp-text)";

export interface AlfredPanelProps {
  open: boolean;
  onClose: () => void;
  accent: string;
  handoff: { id: string | number; query: string } | null;
  newChatTick: number;
  onOpenCalendarItem?: (request: CalendarOpenRequest) => void;
}

function AlfredPanel({ open, onClose, accent, handoff, newChatTick, onOpenCalendarItem }: AlfredPanelProps) {
  const { messages, busy, activeModel, submit, newChat } = useAlfredChat();
  const [previewItem, setPreviewItem] = useState<AlfredEmailItem | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Header-button new-chats bump this; combined with the external newChatTick it
  // forms the composer's clear signal (perf audit fe-alfred::composer-keystroke-
  // rerenders-thread). The draft no longer lives in this component, so the hook's
  // own newChat()→setDraft("") reset can't reach the live input on its own; the
  // composer clears its LOCAL draft whenever this combined signal changes.
  const [headerClearTick, setHeaderClearTick] = useState(0);
  const composerClearSignal = `${newChatTick}:${headerClearTick}`;
  // P3-4: only follow the tail when the user is parked near the bottom. Starts
  // true so the first answer scrolls into view; flipped by onScroll as the user
  // scrolls up to read earlier messages while composing. A ref (not state) so
  // scroll events don't trigger re-renders.
  const stickToBottomRef = useRef(true);

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
    setHeaderClearTick((t) => t + 1);
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
  const handoffSeen = useRef(handoff?.id ?? null);
  useEffect(() => {
    // Don't consume the handoff while a run is in flight — submit would no-op on
    // busyRef and the query would be silently lost. Depending on `busy` re-runs
    // this when the current run finishes, so the dropped handoff fires then.
    if (handoff && handoff.id !== handoffSeen.current && !busy) {
      handoffSeen.current = handoff.id;
      submit(handoff.query);
    }
  }, [handoff, submit, busy]);

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

  const empty = messages.length === 0;

  return createPortal(
    <aside
      aria-hidden={!open}
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
        @media (prefers-reduced-motion: reduce) { .alfred-bar-grow { animation: none; } }
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
              <div className="ea-display" style={{ fontSize: 24, color: text, fontFamily: "var(--serif-choice, 'Instrument Serif', serif)" }}>
                What do you need?
              </div>
              <div style={{ fontSize: 11.5, color: "var(--color-text-faint)", marginTop: 6, lineHeight: 1.55 }}>
                I can read your calendar, deadlines, bills, and mail. Read-only for now.
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 2.2, textTransform: "uppercase", color: "var(--color-text-faint)", marginBottom: 6 }}>Try</div>
              <SuggestionList accent={accent} onPick={(label: string) => submit(label)} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((m) => {
              if (m.type === "user") return <UserLine key={m.id} text={m.text} accent={accent} />;
              if (m.type === "tools") return <ToolSteps key={m.id} tools={m.tools} done={m.done} accent={accent} />;
              if (m.type === "say") return <SayBlock key={m.id} text={m.text} done={m.done} preamble={m.preamble} />;
              if (m.type === "rows") return <RowsBlock key={m.id} kind={m.kind} items={m.items as AlfredRow[]} accent={accent} onActivateItem={onActivateChip} />;
              if (m.type === "summary") return <AlfredTransactionBreakdown key={m.id} buckets={m.buckets} period={m.period} group_by={m.group_by} accent={accent} />;
              if (m.type === "breakdown") return <AlfredBreakdown key={m.id} kind={m.kind} title={m.title} caption={m.caption} total={m.total} buckets={m.buckets as Array<{ label: string; count: number; items: AlfredRow[] }>} accent={accent} onActivateItem={onActivateChip} />;
              if (m.type === "error") return <ErrorLine key={m.id} text={m.text} />;
              return null;
            })}
          </div>
        )}
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
        onSubmit={submit}
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
