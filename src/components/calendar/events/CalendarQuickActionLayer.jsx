import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";

const SCOPE_OPTIONS = [
  { value: "one", label: "Just this one" },
  { value: "following", label: "Upcoming only" },
  { value: "all", label: "All events" },
];

function stop(event) {
  event.stopPropagation();
}

function menuStyle(menu) {
  const width = 220;
  const padding = 12;
  const left = Math.min(
    Math.max(padding, menu.x),
    Math.max(padding, window.innerWidth - width - padding),
  );
  const top = Math.min(
    Math.max(padding, menu.y),
    Math.max(padding, window.innerHeight - 150),
  );
  return { left, top, width };
}

function ActionButton({ children, tone = "default", disabled, onClick, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 32,
        padding: "0 10px",
        borderRadius: 8,
        border: tone === "danger"
          ? "1px solid rgba(243,139,168,0.34)"
          : "1px solid rgba(255,255,255,0.08)",
        background: tone === "danger"
          ? "rgba(243,139,168,0.14)"
          : tone === "primary"
            ? "rgba(203,166,218,0.16)"
            : "rgba(255,255,255,0.04)",
        color: tone === "danger" ? "#f38ba8" : tone === "primary" ? "#cba6da" : "#cdd6f4",
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 150ms, border-color 150ms, transform 150ms",
      }}
    >
      {children}
    </button>
  );
}

function ContextMenu({ quickActions }) {
  const menu = quickActions.contextMenu;
  const ref = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    function handlePointerDown(event) {
      if (ref.current?.contains(event.target)) return;
      quickActions.closeContextMenu();
    }
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      quickActions.closeContextMenu();
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [menu, quickActions]);

  if (!menu) return null;
  const pos = menuStyle(menu);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-testid="calendar-event-context-menu"
      onPointerDown={stop}
      style={{
        position: "fixed",
        zIndex: 70,
        top: pos.top,
        left: pos.left,
        width: pos.width,
        padding: 8,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "#16161e",
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        isolation: "isolate",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {menu.error ? (
        <div data-testid="calendar-quick-action-error" style={{ color: "#f38ba8", fontSize: 11, lineHeight: 1.35, padding: "4px 6px" }}>
          {menu.error}
        </div>
      ) : null}
      {menu.confirm ? (
        <>
          <div style={{ color: "rgba(205,214,244,0.68)", fontSize: 11, lineHeight: 1.4, padding: "4px 6px" }}>
            Delete this event?
          </div>
          <ActionButton tone="danger" disabled={menu.busy} onClick={quickActions.confirmContextDelete} testId="calendar-event-context-confirm-delete">
            {menu.busy ? "Deleting..." : "Confirm delete"}
          </ActionButton>
          <ActionButton disabled={menu.busy} onClick={quickActions.closeContextMenu}>
            Cancel
          </ActionButton>
        </>
      ) : (
        <ActionButton tone="danger" disabled={menu.busy} onClick={quickActions.requestDelete} testId="calendar-event-context-delete">
          Delete
        </ActionButton>
      )}
    </div>,
    document.body,
  );
}

function ScopePrompt({ quickActions }) {
  const prompt = quickActions.prompt;
  const ref = useRef(null);

  useEffect(() => {
    if (!prompt) return undefined;
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      quickActions.cancelPrompt();
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [prompt, quickActions]);

  if (!prompt) return null;
  const title = prompt.kind === "delete" ? "Delete recurring event" : "Move recurring event";

  return createPortal(
    <div
      ref={ref}
      data-testid="calendar-quick-action-scope-prompt"
      role="dialog"
      aria-label={title}
      onPointerDown={stop}
      style={{
        position: "fixed",
        zIndex: 71,
        top: prompt.position.top,
        left: prompt.position.left,
        width: 340,
        padding: 12,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "#16161e",
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        isolation: "isolate",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#eef2ff" }}>{title}</div>
        <div style={{ fontSize: 11, lineHeight: 1.4, color: "rgba(205,214,244,0.58)" }}>
          Choose the recurrence scope before confirming.
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
        {SCOPE_OPTIONS.map((option) => {
          const selected = prompt.selectedScope === option.value;
          return (
            <button
              key={option.value}
              type="button"
              data-testid={`calendar-quick-action-scope-${option.value}`}
              disabled={prompt.confirming}
              onClick={() => quickActions.setPromptScope(option.value)}
              style={{
                minHeight: 36,
                padding: "7px 8px",
                borderRadius: 8,
                border: selected
                  ? "1px solid rgba(203,166,218,0.38)"
                  : "1px solid rgba(255,255,255,0.08)",
                background: selected ? "rgba(203,166,218,0.15)" : "rgba(255,255,255,0.035)",
                color: selected ? "#cba6da" : "#cdd6f4",
                fontSize: 10.5,
                lineHeight: 1.2,
                fontWeight: 700,
                cursor: prompt.confirming ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {prompt.error ? (
        <div data-testid="calendar-quick-action-error" style={{ color: "#f38ba8", fontSize: 11, lineHeight: 1.35 }}>
          {prompt.error}
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ActionButton disabled={prompt.confirming} onClick={quickActions.cancelPrompt}>
          Cancel
        </ActionButton>
        <ActionButton tone={prompt.kind === "delete" ? "danger" : "primary"} disabled={prompt.confirming} onClick={quickActions.confirmPrompt} testId="calendar-quick-action-confirm">
          {prompt.confirming ? "Working..." : "Confirm"}
        </ActionButton>
      </div>
    </div>,
    document.body,
  );
}

function Status({ quickActions }) {
  if (!quickActions.status) return null;
  const toneColor = quickActions.status.tone === "error"
    ? "#f38ba8"
    : quickActions.status.tone === "success"
      ? "#a6e3a1"
      : "#cba6da";

  return (
    <div
      data-testid="calendar-quick-action-status"
      style={{
        position: "absolute",
        right: 0,
        bottom: -28,
        zIndex: 2,
        padding: "5px 8px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "#16161e",
        color: toneColor,
        fontSize: 10.5,
        fontWeight: 700,
        boxShadow: "0 10px 30px rgba(0,0,0,0.38)",
      }}
    >
      {quickActions.status.message}
    </div>
  );
}

export default function CalendarQuickActionLayer({ quickActions }) {
  if (!quickActions) return null;
  return (
    <>
      <Status quickActions={quickActions} />
      <ContextMenu quickActions={quickActions} />
      <ScopePrompt quickActions={quickActions} />
    </>
  );
}
