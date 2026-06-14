// The Alfred Panel (CONTEXT.md): right-docked dashboard chat surface, toggled
// with Cmd/Ctrl+\. Overlays the dashboard without reflowing it. Stays mounted
// while closed so the Alfred Conversation survives close/reopen; cleared only
// by new chat (Cmd/Ctrl+Shift+\ → newChatTick).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, RotateCcw, X } from "lucide-react";
import useAlfredChat from "./useAlfredChat.js";
import { alfredModelByKey } from "./alfredPanelModel.js";
import {
  ErrorLine,
  ModelToggle,
  SayBlock,
  SuggestionList,
  ToolRows,
  UserLine,
} from "./AlfredMessages.jsx";
import { RowsBlock } from "./AlfredRows.jsx";
import AlfredEmailPreview from "./AlfredEmailPreview.jsx";

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

export default function AlfredPanel({ open, onClose, accent, handoff, newChatTick, onOpenCalendarItem }) {
  const { messages, busy, modelKey, setModelKey, draft, setDraft, submit, newChat } = useAlfredChat();
  const [previewItem, setPreviewItem] = useState(null);
  const scrollerRef = useRef(null);
  const inputRef = useRef(null);

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

  // keep scrolled to the newest message (handoff: scrollTop, not scrollIntoView)
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  // focus composer after the open transition
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => inputRef.current?.focus(), 260);
    return () => clearTimeout(t);
  }, [open]);

  // ⌘⇧\ new chat. newChat() owns the full reset (messages, draft, abort,
  // server delete) — external work that must stay in an effect, not render.
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
    if (handoff && handoff.id !== handoffSeen.current) {
      handoffSeen.current = handoff.id;
      submit(handoff.query);
    }
  }, [handoff, submit]);

  // The panel owns Esc ordering for its overlay stack: preview first, panel
  // second. Document capture + consume, so the calendar's own capture-phase
  // hotkeys (and anything beneath) never see an Esc that Alfred handled.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (previewItem) setPreviewItem(null);
      else onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, previewItem, onClose]);

  function onComposerKey(e) {
    if (e.key === "Enter" && draft.trim()) {
      e.preventDefault();
      submit(draft.trim());
      setDraft("");
    }
  }

  function onActivateChip(action) {
    if (action.type === "email") {
      setPreviewItem(action.item);
    } else if (action.type === "calendar") {
      setPreviewItem(null);
      onOpenCalendarItem?.(action.request);
    }
  }

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
        background: "#16161e",
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
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2.2, textTransform: "uppercase", color: dim }}>
          Alfred
        </span>
        <span style={{ flex: 1 }} />
        <ModelToggle modelKey={modelKey} onChange={setModelKey} accent={accent} />
        <button type="button" title="New chat (⌘⇧\)" onClick={newChat}
          style={{ display: "inline-flex", padding: "4px 7px", background: "transparent", border: "none", cursor: "pointer", color: dim, borderRadius: 6 }}>
          <RotateCcw size={11} />
        </button>
        <button type="button" title="Close (esc)" onClick={onClose}
          style={{ display: "inline-flex", padding: "4px 7px", background: "transparent", border: "none", cursor: "pointer", color: dim, borderRadius: 6 }}>
          <X size={12} />
        </button>
      </div>

      {/* thread */}
      <div ref={scrollerRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 14px 6px" }}>
        {empty ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 26 }}>
            <div>
              <div className="ea-display" style={{ fontSize: 24, color: text, fontFamily: "var(--serif-choice, 'Instrument Serif', serif)" }}>
                What do you need?
              </div>
              <div style={{ fontSize: 11.5, color: "rgba(205,214,244,0.5)", marginTop: 6, lineHeight: 1.55 }}>
                I can read your calendar, deadlines, bills, and mail. Read-only for now.
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 2.2, textTransform: "uppercase", color: "rgba(205,214,244,0.4)", marginBottom: 6 }}>Try</div>
              <SuggestionList accent={accent} onPick={(label) => submit(label)} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((m) => {
              if (m.type === "user") return <UserLine key={m.id} text={m.text} accent={accent} />;
              if (m.type === "tools") return <ToolRows key={m.id} tools={m.tools} accent={accent} />;
              if (m.type === "say") return <SayBlock key={m.id} text={m.text} done={m.done} />;
              if (m.type === "rows") return <RowsBlock key={m.id} kind={m.kind} items={m.items} accent={accent} onActivateItem={onActivateChip} />;
              if (m.type === "error") return <ErrorLine key={m.id} text={m.text} />;
              return null;
            })}
          </div>
        )}
      </div>

      {/* composer */}
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
            onClick={() => { if (draft.trim()) { submit(draft.trim()); setDraft(""); } }}
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
          <span style={{ whiteSpace: "nowrap" }}>{alfredModelByKey(modelKey).hint}</span>
        </div>
      </div>

      {previewItem ? (
        <AlfredEmailPreview item={previewItem} onClose={() => setPreviewItem(null)} />
      ) : null}
    </aside>,
    document.body,
  );
}
