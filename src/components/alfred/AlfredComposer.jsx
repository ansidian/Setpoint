// Alfred composer: the input + send button + shortcut/model footer, split out of
// AlfredPanel so the draft lives in LOCAL state (perf audit fe-alfred::
// composer-keystroke-rerenders-thread). Keeping the draft here means a keystroke
// re-renders only this component, not AlfredPanel and its message thread.
//
// Behaviour is identical to the inline composer it replaced: Enter (with a
// non-empty trimmed draft) submits and clears; the send button is disabled while
// busy or empty and submits+clears on click; the placeholder/disabled state and
// the focus-after-open transition match the prior panel logic. The draft is
// lifted to the chat hook only on submit (via onSubmit); new chat clears it
// through clearSignal.
import { memo, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

const dim = "rgba(205,214,244,0.55)";
const text = "#cdd6f4";
const mono = "var(--font-mono, 'Fira Code', ui-monospace, monospace)";

function Kbd({ children }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: 14, padding: "1px 4px", borderRadius: 4,
      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
      fontFamily: mono, fontSize: 8.5, color: dim,
    }}>{children}</span>
  );
}

function AlfredComposer({ open, busy, accent, modelHint, clearSignal, onSubmit }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  // New chat (header button or ⌘⇧\) changes clearSignal; clear the local draft to
  // match. React's documented "adjust state when a prop changes during render"
  // pattern (store the previous signal in state + compare) — commits in the same
  // render pass, no extra paint, and stays clear of the set-state-in-effect lint.
  const [prevClearSignal, setPrevClearSignal] = useState(clearSignal);
  if (prevClearSignal !== clearSignal) {
    setPrevClearSignal(clearSignal);
    if (draft !== "") setDraft("");
  }

  // focus composer after the open transition (moved verbatim from AlfredPanel)
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => inputRef.current?.focus(), 260);
    return () => clearTimeout(t);
  }, [open]);

  function send() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setDraft("");
  }

  function onComposerKey(e) {
    if (e.key === "Enter" && draft.trim()) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div style={{ padding: "10px 14px 12px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          ref={inputRef}
          value={draft}
          disabled={busy}
          placeholder={busy ? "Working…" : "Ask about your day…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onComposerKey}
          style={{
            flex: 1, fontSize: 12, color: text, fontFamily: "inherit",
            padding: "8px 10px", borderRadius: 8, outline: "none",
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          }}
        />
        <button
          type="button"
          disabled={busy || !draft.trim()}
          onClick={send}
          title="Send"
          style={{
            display: "inline-flex", padding: "8px 10px", borderRadius: 8, border: "none",
            cursor: busy || !draft.trim() ? "default" : "pointer",
            background: busy || !draft.trim() ? "rgba(255,255,255,0.05)" : accent,
            color: busy || !draft.trim() ? dim : "#16161e",
          }}
        >
          <ArrowUp size={12} strokeWidth={2.4} />
        </button>
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, marginTop: 8,
        fontSize: 9, color: "rgba(205,214,244,0.35)", fontFamily: mono,
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
  );
}

// memo so token streaming (which re-renders AlfredPanel) doesn't re-render the
// composer; its props are stable across streaming (onSubmit is useCallback'd).
export default memo(AlfredComposer);
