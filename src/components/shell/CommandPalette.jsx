import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LayoutList, Inbox, Clock, AlertCircle, CreditCard, Sparkles,
  RefreshCw, Search, ArrowRight, Calendar, History, Settings as SettingsIcon, Sliders,
  CalendarPlus, ListPlus,
} from "lucide-react";

/**
 * CommandPalette — ⌘K overlay.
 * Only renders when open. State resets naturally on mount so the cursor
 * starts at 0 and the query is empty each time the palette opens.
 */
export default function CommandPalette({ open, ...rest }) {
  if (!open) return null;
  return <CommandPaletteInner {...rest} />;
}

function CommandPaletteInner({ accent, onClose, onAction }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = useMemo(() => [
    { id: "go-dashboard", icon: LayoutList, label: "Go to Dashboard", hint: "1", kind: "tab", payload: "dashboard" },
    { id: "go-inbox",     icon: Inbox,      label: "Go to Inbox",     hint: "2", kind: "tab", payload: "inbox" },
    { id: "timeline",     icon: Clock,      label: "Today timeline",  kind: "scroll", payload: "timeline" },
    { id: "insights",     icon: Sparkles,   label: "AI insights",     kind: "scroll", payload: "insights" },
    { id: "deadlines",    icon: AlertCircle, label: "Deadlines",      kind: "scroll", payload: "deadlines" },
    { id: "bills",        icon: CreditCard, label: "Bills",           kind: "scroll", payload: "bills" },
    { id: "new-todoist",  icon: ListPlus,   label: "New Todoist task", hint: "G T", kind: "todoist" },
    { id: "new-event",    icon: CalendarPlus, label: "New event",     hint: "G C", kind: "event" },
    { id: "calendar",     icon: Calendar,   label: "Open calendar",   hint: "C", kind: "calendar" },
    { id: "history",      icon: History,    label: "Briefing history", kind: "history" },
    { id: "customize",    icon: Sliders,    label: "Customize",       kind: "customize" },
    { id: "refresh",      icon: RefreshCw,  label: "Refresh data",    hint: "R", kind: "refresh" },
    { id: "regenerate",   icon: Sparkles,   label: "Generate fresh AI briefing", kind: "regenerate" },
    { id: "settings",     icon: SettingsIcon, label: "Open settings", kind: "settings" },
  ], []);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, query]);

  // Clamp during render so out-of-range cursors never reach a child — safer
  // than a setState-in-effect reconciliation.
  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

  function run(item) {
    if (!item) return;
    onAction(item);
    onClose();
  }

  function onInputKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(Math.min(filtered.length - 1, safeCursor + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(Math.max(0, safeCursor - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[safeCursor]);
    }
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)",
        display: "grid", placeItems: "start center",
        paddingTop: 120,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, borderRadius: 14,
          background: "#16161e",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.7)",
          overflow: "hidden",
          isolation: "isolate",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "14px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <Search size={14} color="rgba(205,214,244,0.5)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={onInputKey}
            placeholder="Jump to anything…"
            style={{
              flex: 1, background: "transparent", border: "none",
              color: "#cdd6f4", fontSize: 14, outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>
        <div style={{ padding: 6, maxHeight: 400, overflow: "auto" }}>
          {filtered.map((item, i) => {
            const Icon = item.icon;
            const active = i === safeCursor;
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onMouseEnter={() => setCursor(i)}
                onClick={() => run(item)}
                onKeyDown={(e) => { if (e.key === "Enter") run(item); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 7, cursor: "pointer",
                  fontSize: 12.5, color: "#cdd6f4",
                  background: active ? `${accent}12` : "transparent",
                  border: `1px solid ${active ? `${accent}30` : "transparent"}`,
                  transition: "background 150ms",
                }}
              >
                <Icon size={13} color={active ? accent : "rgba(205,214,244,0.55)"} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.hint && (
                  <kbd
                    style={{
                      fontSize: 10, fontFamily: "Fira Code, monospace",
                      padding: "1px 5px", borderRadius: 3,
                      background: "rgba(255,255,255,0.04)",
                      color: "rgba(205,214,244,0.5)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {item.hint}
                  </kbd>
                )}
                <ArrowRight size={11} color="rgba(205,214,244,0.3)" />
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "rgba(205,214,244,0.4)" }}>
              No matches.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
