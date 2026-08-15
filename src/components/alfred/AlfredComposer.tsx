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
import type { KeyboardEvent, ReactNode } from "react";
import { ArrowUp } from "lucide-react";
import {
  AlfredEmailHistoryNotice,
  AlfredPendingEmailContextCard,
} from "./AlfredEmailContext";
import type { AlfredPendingEmailContext } from "./alfredEmailContextModel";
import type { AlfredSubmitResult } from "./useAlfredChat";

const dim = "rgba(205,214,244,0.55)";
const text = "var(--sp-text)";
const mono = "var(--font-mono, 'Fira Code', ui-monospace, monospace)";

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: 14, padding: "1px 4px", borderRadius: 4,
      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
      fontFamily: mono, fontSize: 8.5, color: "var(--color-text-faint)",
    }}>{children}</span>
  );
}

export interface AlfredComposerProps {
  open: boolean;
  busy: boolean;
  accent: string;
  modelHint: string;
  clearSignal: string | number;
  focusSignal?: string | number | null;
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
  const [draft, setDraft] = useState("");
  const [reviewCue, setReviewCue] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);

  // New chat (header button or ⌘⇧\) changes clearSignal; clear the local draft to
  // match. React's documented "adjust state when a prop changes during render"
  // pattern (store the previous signal in state + compare) — commits in the same
  // render pass, no extra paint, and stays clear of the set-state-in-effect lint.
  const [prevClearSignal, setPrevClearSignal] = useState(clearSignal);
  if (prevClearSignal !== clearSignal) {
    setPrevClearSignal(clearSignal);
    if (draft !== "") setDraft("");
    if (reviewCue !== null) setReviewCue(null);
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

  async function send(): Promise<void> {
    const trimmed = draft.trim();
    const contextReady = !pendingEmail || pendingEmail.status === "ready";
    if (!trimmed || busy || sendingRef.current || !contextReady) return;
    sendingRef.current = true;
    setDraft("");
    setReviewCue(null);
    const result = await onSubmit(trimmed);
    sendingRef.current = false;
    if (result.status === "error" || result.status === "ignored") setDraft(trimmed);
  }

  function onComposerKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" && draft.trim()) {
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          ref={inputRef}
          value={draft}
          disabled={busy}
          placeholder={busy ? "Working…" : pendingEmail ? "Ask about this email…" : "Ask about your day…"}
          onChange={(e) => {
            setDraft(e.target.value);
            if (reviewCue) setReviewCue(null);
          }}
          onKeyDown={onComposerKey}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60"
          style={{
            flex: 1, fontSize: 12, color: text, fontFamily: "inherit",
            padding: "8px 10px", borderRadius: 8, outline: "none",
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          }}
        />
        <button
          type="button"
          disabled={sendDisabled}
          onClick={() => { void send(); }}
          title="Send"
          aria-label="Send message to Alfred"
          className="transition-[filter,transform] duration-150 enabled:hover:-translate-y-px enabled:hover:brightness-110 enabled:focus-visible:outline-none enabled:focus-visible:ring-2 enabled:focus-visible:ring-[color:var(--ea-accent)]/60 enabled:active:translate-y-0 enabled:active:brightness-95 motion-reduce:transition-none motion-reduce:transform-none"
          style={{
            display: "inline-flex", padding: "8px 10px", borderRadius: 8, border: "none",
            cursor: sendDisabled ? "default" : "pointer",
            background: sendDisabled ? "rgba(255,255,255,0.05)" : accent,
            color: sendDisabled ? dim : "#16161e",
          }}
        >
          <ArrowUp size={12} strokeWidth={2.4} />
        </button>
        </div>
        <div style={{
        display: "flex", alignItems: "center", gap: 6, marginTop: 8,
        fontSize: 9, color: "var(--color-text-faint)", fontFamily: mono,
        }}>
        <Kbd>⌘</Kbd><Kbd>\</Kbd>
        <span style={{ whiteSpace: "nowrap" }}>toggle</span>
        <span>·</span>
        <Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>\</Kbd>
        <span style={{ whiteSpace: "nowrap" }}>new chat</span>
        <span style={{ flex: 1 }} />
        <span style={{ whiteSpace: "nowrap" }}>{modelHint}</span>
        </div>
      </div>
    </div>
  );
}

// memo so token streaming (which re-renders AlfredPanel) doesn't re-render the
// composer; its props are stable across streaming (onSubmit is useCallback'd).
export default memo(AlfredComposer);
