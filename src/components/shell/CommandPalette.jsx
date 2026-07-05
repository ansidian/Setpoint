import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  LayoutList, Inbox, Clock, AlertCircle, CreditCard,
  RefreshCw, Search, ArrowRight, CalendarDays, History, Settings as SettingsIcon,
  CalendarPlus, ListPlus, Notebook, Newspaper,
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
    { id: "deadlines",    icon: AlertCircle, label: "Deadlines",      kind: "scroll", payload: "deadlines" },
    { id: "bills",        icon: CreditCard, label: "Bills",           kind: "scroll", payload: "bills" },
    { id: "new-deadline", icon: ListPlus,   label: "New deadline",     hint: "G T", kind: "deadline-create" },
    { id: "new-event",    icon: CalendarPlus, label: "New event",     hint: "G C", kind: "event" },
    { id: "calendar",     icon: CalendarDays, label: "Go to Calendar",  hint: "3", kind: "tab", payload: "calendar" },
    { id: "go-notes",     icon: Notebook,   label: "Go to Notes",      hint: "4", kind: "tab", payload: "notes" },
    { id: "go-news",      icon: Newspaper,  label: "Go to News",       hint: "5", kind: "tab", payload: "news" },
    { id: "analytics",    icon: BarChart3,  label: "Analytics",       hint: "A", kind: "analytics" },
    { id: "history",      icon: History,    label: "Snapshots", hint: "Y", kind: "history" },
{ id: "refresh",      icon: RefreshCw,  label: "Sync now",        hint: "R", kind: "refresh" },
    { id: "settings",     icon: SettingsIcon, label: "Open settings", hint: ["⌘", ","], shortcutLabel: "Command comma", kind: "settings" },
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
      // Presence-based marker: the calendar's hotkey handler goes fully inert
      // while this blocking overlay is mounted (its pre-editable branches —
      // Cmd+F, the Escape cascade, bare Meta — would otherwise fire beneath
      // the palette's focused input).
      data-suspend-calendar-hotkeys="blocking"
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        // Static CSS faux-frost — no live backdrop-filter (which would re-blur the
        // whole viewport every frame the dashboard's now-marker / status dots
        // animate behind it) and no per-open html-to-image snapshot. A top
        // highlight + edge vignette over a light dim reads as frosted depth at
        // zero runtime cost. Lighter dim than analytics: the palette is small and
        // the frost is meant to be seen here.
        backgroundColor: "rgba(8,8,14,0.50)",
        backgroundImage: [
          "radial-gradient(120% 90% at 50% -10%, rgba(120,130,170,0.12), transparent 60%)",
          "radial-gradient(140% 120% at 50% 50%, transparent 55%, rgba(0,0,0,0.26))",
          "linear-gradient(rgba(8,8,14,0.36), rgba(8,8,14,0.50))",
        ].join(", "),
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
        display: "grid", placeItems: "start center",
        paddingTop: 120,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, borderRadius: 14,
          background: "var(--sp-panel)",
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
              color: "var(--sp-text)", fontSize: 14, outline: "none",
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
                  fontSize: 12.5, color: "var(--sp-text)",
                  background: active ? `${accent}12` : "transparent",
                  border: `1px solid ${active ? `${accent}30` : "transparent"}`,
                  transition: "background 150ms",
                }}
              >
                <Icon size={13} color={active ? accent : "rgba(205,214,244,0.55)"} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.hint && (
                  <span
                    aria-label={item.shortcutLabel}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    {(Array.isArray(item.hint) ? item.hint : [item.hint]).map((key) => (
                      <kbd
                        key={key}
                        style={{
                          fontSize: 10, fontFamily: "Fira Code, monospace",
                          padding: "1px 5px", borderRadius: 3,
                          background: "rgba(255,255,255,0.04)",
                          color: "var(--color-text-faint)",
                          border: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                )}
                <ArrowRight size={11} color="rgba(205,214,244,0.3)" />
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--color-text-faint)" }}>
              No matches.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
