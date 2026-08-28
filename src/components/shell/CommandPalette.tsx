import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { motion as Motion, useReducedMotion } from "motion/react";
import {
  BarChart3,
  LayoutList, Inbox, CreditCard,
  Search, ArrowRight, CalendarDays, History, Settings as SettingsIcon,
  Notebook, Newspaper,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motionDuration, motionTransition } from "../../lib/motion";
import useMotionPresence from "../../hooks/useMotionPresence";
import { isDemoMode } from "../../demo/config";

export interface CommandPaletteItem {
  id: string;
  icon: LucideIcon;
  label: string;
  aliases: string[];
  kind: string;
  payload?: string;
}

export interface CommandPaletteProps {
  open: boolean;
  accent: string;
  onClose: () => void;
  onAction: (item: CommandPaletteItem) => void;
}

/**
 * CommandPalette — ⌘K overlay.
 * Only renders when open. State resets naturally on mount so the cursor
 * starts at 0 and the query is empty each time the palette opens.
 */
export default function CommandPalette({ open, ...rest }: CommandPaletteProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const rendered = useMotionPresence(open, reduceMotion ? 0 : motionDuration.exit * 1000);
  if (!rendered) return null;
  return createPortal(
    <CommandPaletteInner open={open} reduceMotion={reduceMotion} {...rest} />,
    document.body,
  );
}

function CommandPaletteInner({ open, reduceMotion, accent, onClose, onAction }: Omit<CommandPaletteProps, "open"> & { open: boolean; reduceMotion: boolean }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const items = useMemo<CommandPaletteItem[]>(() => [
    { id: "go-dashboard", icon: LayoutList, label: "Go to Dashboard", aliases: ["home", "today", "overview", "briefing"], kind: "tab", payload: "dashboard" },
    { id: "go-inbox",     icon: Inbox,      label: "Go to Inbox",     aliases: ["email", "mail", "messages"], kind: "tab", payload: "inbox" },
    { id: "bills",        icon: CreditCard, label: "Go to Bills",     aliases: ["payments", "payables"], kind: "calendar-view", payload: "bills" },
    { id: "events",       icon: CalendarDays, label: "Go to Events",  aliases: ["calendar", "schedule", "meetings"], kind: "calendar-view", payload: "events" },
    ...(!isDemoMode() ? [{ id: "go-notes", icon: Notebook, label: "Go to Notes", aliases: ["ideas", "canvas", "tldraw"], kind: "tab", payload: "notes" }] : []),
    { id: "go-news",      icon: Newspaper,  label: "Go to News",      aliases: ["articles", "headlines", "feed"], kind: "tab", payload: "news" },
    { id: "analytics",    icon: BarChart3,  label: "Analytics",       aliases: ["stats", "metrics", "insights"], kind: "analytics" },
    { id: "history",      icon: History,    label: "Snapshots",       aliases: ["history", "past briefings"], kind: "history" },
    { id: "settings",     icon: SettingsIcon, label: "Go to Settings", aliases: ["preferences", "configuration", "config", "setup"], kind: "settings" },
  ], []);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.trim().toLowerCase();
    const labelMatches = items.filter((item) => item.label.toLowerCase().includes(q));
    const aliasMatches = items.filter((item) => (
      !item.label.toLowerCase().includes(q)
      && item.aliases.some((alias) => alias.includes(q))
    ));
    return [...labelMatches, ...aliasMatches];
  }, [items, query]);

  // Clamp during render so out-of-range cursors never reach a child — safer
  // than a setState-in-effect reconciliation.
  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

  function run(item: CommandPaletteItem | undefined): void {
    if (!item) return;
    onAction(item);
    onClose();
  }

  function onInputKey(e: ReactKeyboardEvent<HTMLInputElement>): void {
    const numberIndex = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
      ? e.key === "0"
        ? 9
        : /^[1-9]$/.test(e.key)
          ? Number(e.key) - 1
          : -1
      : -1;

    if (numberIndex >= 0) {
      e.preventDefault();
      const item = filtered[numberIndex];
      if (!item) return;
      run(item);
    } else if (e.key === "ArrowDown") {
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

  return (
    <Motion.div
      initial={{ opacity: reduceMotion ? 1 : 0 }}
      animate={{ opacity: open ? 1 : 0 }}
      transition={motionTransition(reduceMotion, motionDuration.exit)}
      onClick={open ? onClose : undefined}
      aria-hidden={!open}
      inert={!open ? true : undefined}
      // Presence-based marker: the calendar's hotkey handler goes fully inert
      // while this blocking overlay is mounted (its pre-editable branches —
      // Cmd+F, the Escape cascade, bare Meta — would otherwise fire beneath
      // the palette's focused input).
      data-suspend-calendar-hotkeys={open ? "blocking" : undefined}
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
      <Motion.div
        initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.985 }}
        animate={open
          ? { opacity: 1, y: 0, scale: 1 }
          : reduceMotion
            ? { opacity: 0 }
            : { opacity: 0, y: -5, scale: 0.99 }}
        transition={motionTransition(reduceMotion, open ? motionDuration.panel : motionDuration.exit)}
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
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="command-palette-listbox"
            aria-activedescendant={filtered.length ? `command-palette-option-${filtered[safeCursor]?.id}` : undefined}
            aria-label="Command palette"
            style={{
              flex: 1, background: "transparent", border: "none",
              color: "var(--sp-text)", fontSize: 14, outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>
        <div role="listbox" id="command-palette-listbox" style={{ padding: 6, maxHeight: 400, overflow: "auto" }}>
          {filtered.map((item, i) => {
            const Icon = item.icon;
            const active = i === safeCursor;
            const numberHint = i < 10 ? String((i + 1) % 10) : null;
            return (
              <div
                key={item.id}
                id={`command-palette-option-${item.id}`}
                role="option"
                aria-selected={i === safeCursor}
                aria-keyshortcuts={numberHint ?? undefined}
                onMouseEnter={() => setCursor(i)}
                onClick={() => run(item)}
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
                {numberHint && (
                  <kbd
                    style={{
                      fontSize: 10, fontFamily: "Fira Code, monospace",
                      padding: "1px 5px", borderRadius: 3,
                      background: "rgba(255,255,255,0.04)",
                      color: "var(--color-text-faint)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {numberHint}
                  </kbd>
                )}
                <ArrowRight size={11} color="rgba(205,214,244,0.3)" />
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div role="status" style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--color-text-faint)" }}>
              No matches.
            </div>
          )}
        </div>
      </Motion.div>
    </Motion.div>
  );
}
