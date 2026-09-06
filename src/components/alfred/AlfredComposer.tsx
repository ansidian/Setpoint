// Alfred composer: the input + send button + shortcut/model footer, split out of
// AlfredPanel so the draft lives in LOCAL state (perf audit fe-alfred::
// composer-keystroke-rerenders-thread). Keeping the draft here means a keystroke
// re-renders only this component, not AlfredPanel and its message thread.
//
// The draft is lifted to the chat hook only on submit. A failed submission is
// restored locally, while a normal new-chat action clears it through
// clearSignal. Pending email preparation never prevents typing, but it does
// prevent sending until the server has returned a context handle.
import { memo, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import {
  AlfredEmailHistoryNotice,
  AlfredPendingEmailContextCard,
} from "./AlfredEmailContext";
import type { AlfredPendingEmailContext } from "./alfredEmailContextModel";
import type { AlfredSubmitResult } from "./useAlfredChat";

const dim = "rgba(205,214,244,0.55)";
const text = "var(--sp-text)";
export interface AlfredComposerProps {
  open: boolean;
  busy: boolean;
  accent: string;
  modelHint: string;
  clearSignal: string | number;
  focusSignal?: string | number | null;
  draftRequest?: { id: string | number; text: string } | null;
  onStop?: () => void;
  pendingEmail: AlfredPendingEmailContext | null;
  priorEmailCount: number;
  overflowRecovery: boolean;
  onPreviewEmail: () => void;
  onRetryEmail: () => void;
  onRemoveEmail: () => void;
  onStartNewChat: () => void;
  onRecoverNewChat: () => void;
  onSubmit: (text: string) => Promise<AlfredSubmitResult>;
}

function AlfredComposer({
  open,
  busy,
  accent,
  modelHint,
  clearSignal,
  focusSignal = null,
  draftRequest = null,
  onStop,
  pendingEmail,
  priorEmailCount,
  overflowRecovery,
  onPreviewEmail,
  onRetryEmail,
  onRemoveEmail,
  onStartNewChat,
  onRecoverNewChat,
  onSubmit,
}: AlfredComposerProps) {
  const [draftState, setDraftState] = useState({ text: "", revision: 0 });
  const draft = draftState.text;
  function setDraft(value: string) {
    setDraftState((current) => ({ text: value, revision: current.revision + 1 }));
  }
  const [reviewCue, setReviewCue] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);

  // New chat (header button or ⌘⇧\) changes clearSignal; clear the local draft to
  // match. React's documented "adjust state when a prop changes during render"
  // pattern (store the previous signal in state + compare) — commits in the same
  // render pass, no extra paint, and stays clear of the set-state-in-effect lint.
  const [prevClearSignal, setPrevClearSignal] = useState(clearSignal);
  if (prevClearSignal !== clearSignal) {
    setPrevClearSignal(clearSignal);
    setDraft("");
    if (reviewCue !== null) setReviewCue(null);
  }

  const requestId = draftRequest?.id ?? null;
  const [previousRequestId, setPreviousRequestId] = useState<string | number | null>(null);
  if (previousRequestId !== requestId) {
    setPreviousRequestId(requestId);
    if (draftRequest) {
      setDraft(draftRequest.text);
      if (reviewCue !== null) setReviewCue(null);
    }
  }

  const attachmentKey = pendingEmail?.key ?? null;
  const [previousAttachmentKey, setPreviousAttachmentKey] = useState(attachmentKey);
  if (previousAttachmentKey !== attachmentKey) {
    const replaced = previousAttachmentKey !== null && attachmentKey !== null;
    setPreviousAttachmentKey(attachmentKey);
    if (replaced && draft.trim()) setReviewCue("Attachment replaced—review your prompt");
  }

  // focus composer after the open transition (moved verbatim from AlfredPanel)
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => inputRef.current?.focus(), 260);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || focusSignal == null) return;
    inputRef.current?.focus();
  }, [focusSignal, open]);

  useEffect(() => {
    if (open && requestId != null) inputRef.current?.focus();
  }, [open, requestId]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(150, Math.max(62, input.scrollHeight))}px`;
  }, [draft, open]);

  async function send(): Promise<void> {
    const trimmed = draft.trim();
    const contextReady = !pendingEmail || pendingEmail.status === "ready";
    if (!trimmed || busy || sendingRef.current || !contextReady) return;
    sendingRef.current = true;
    const sentRevision = draftState.revision + 1;
    setDraft("");
    setReviewCue(null);
    const result = await onSubmit(trimmed);
    sendingRef.current = false;
    if (result.status === "error" || result.status === "ignored") {
      // A later edit, suggestion, or New chat owns the draft now. Never overwrite it.
      setDraftState((current) => current.revision === sentRevision
        ? { text: trimmed, revision: current.revision + 1 }
        : current);
    }
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      void send();
    }
  }

  const contextReady = !pendingEmail || pendingEmail.status === "ready";
  const sendDisabled = busy || !draft.trim() || !contextReady;
  const showHistoryNotice = Boolean(pendingEmail && priorEmailCount > 0);

  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
      {pendingEmail && (overflowRecovery || showHistoryNotice) ? (
        <AlfredEmailHistoryNotice
          count={priorEmailCount}
          overflowRecovery={overflowRecovery}
          onStartNewChat={overflowRecovery ? onRecoverNewChat : onStartNewChat}
        />
      ) : null}
      <div style={{ padding: "10px 14px 12px" }}>
        {pendingEmail ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            <AlfredPendingEmailContextCard
              pending={pendingEmail}
              accent={accent}
              onPreview={onPreviewEmail}
              onRetry={onRetryEmail}
              onRemove={onRemoveEmail}
            />
            <span aria-live="polite" style={{ minHeight: reviewCue ? 13 : 0, color: "var(--sp-blue)", fontSize: 9.5, lineHeight: 1.35 }}>
              {reviewCue || ""}
            </span>
          </div>
        ) : null}
        <div
          className="focus-within:ring-1 focus-within:ring-[color:var(--ea-accent)]"
          style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.02)" }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            rows={2}
            aria-label="Message to Alfred"
            placeholder={pendingEmail ? "Ask about this email…" : "Ask across mail, calendar, and finances…"}
            onChange={(e) => {
              setDraft(e.target.value);
              if (reviewCue) setReviewCue(null);
            }}
            onKeyDown={onComposerKey}
            className="placeholder:text-[color:var(--color-text-faint)] focus-visible:outline-none"
            style={{
              display: "block", width: "100%", minHeight: 62, maxHeight: 150,
              resize: "none", fontSize: 12, lineHeight: 1.6, color: text, fontFamily: "inherit",
              padding: 0, outline: "none", background: "transparent", border: "none", caretColor: accent,
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 8 }}>
            <span style={{ color: "var(--color-text-faint)", fontSize: 10 }}>
              {busy ? "You can draft your next question" : null}
            </span>
            <button
              type="button"
              disabled={busy && onStop ? false : sendDisabled}
              onClick={() => { if (busy && onStop) onStop(); else void send(); }}
              title={busy && onStop ? "Stop response" : "Send"}
              aria-label={busy && onStop ? "Stop Alfred response" : "Send message to Alfred"}
              className="transition-[filter,transform] duration-150 enabled:hover:-translate-y-px enabled:hover:brightness-110 enabled:focus-visible:outline-none enabled:focus-visible:ring-2 enabled:focus-visible:ring-[color:var(--ea-accent)]/60 enabled:active:translate-y-0 enabled:active:brightness-95 motion-reduce:transition-none motion-reduce:transform-none"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 7, border: "none", fontSize: 11,
                cursor: busy && onStop || !sendDisabled ? "pointer" : "default",
                background: busy && onStop || !sendDisabled ? accent : "rgba(255,255,255,0.05)",
                color: busy && onStop || !sendDisabled ? "#16161e" : dim,
              }}
            >
              {busy && onStop ? <Square size={12} /> : <ArrowUp size={12} strokeWidth={2.4} />}
              {busy && onStop ? "Stop" : "Send"}
            </button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginTop: 8, fontSize: 10, color: "var(--color-text-faint)" }}>
          <span>Enter to send · Shift+Enter for a new line</span>
          <span title={modelHint}>Temporary session</span>
        </div>
      </div>
    </div>
  );
}

// memo so token streaming (which re-renders AlfredPanel) doesn't re-render the
// composer; its props are stable across streaming (onSubmit is useCallback'd).
export default memo(AlfredComposer);
