import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

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

function actionButtonColors(tone, active) {
  if (tone === "danger") {
    return {
      border: active ? "1px solid rgba(243,139,168,0.52)" : "1px solid rgba(243,139,168,0.34)",
      background: active ? "rgba(243,139,168,0.20)" : "rgba(243,139,168,0.14)",
      color: "#f38ba8",
    };
  }
  if (tone === "primary") {
    return {
      border: active ? "1px solid rgba(203,166,218,0.42)" : "1px solid rgba(255,255,255,0.08)",
      background: active ? "rgba(203,166,218,0.22)" : "rgba(203,166,218,0.16)",
      color: "#cba6da",
    };
  }
  return {
    border: active ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(255,255,255,0.08)",
    background: active ? "rgba(255,255,255,0.075)" : "rgba(255,255,255,0.04)",
    color: "#cdd6f4",
  };
}

function ActionButton({ children, tone = "default", disabled, onClick, testId }) {
  const [active, setActive] = useState(false);
  const colors = actionButtonColors(tone, active && !disabled);

  return (
    <button
      type="button"
      data-testid={testId}
      data-calendar-focus-ring="true"
      disabled={disabled}
      onClick={onClick}
      onPointerEnter={() => {
        if (!disabled) setActive(true);
      }}
      onPointerLeave={() => setActive(false)}
      onFocus={() => {
        if (!disabled) setActive(true);
      }}
      onBlur={() => setActive(false)}
      style={{
        height: 32,
        padding: "0 10px",
        borderRadius: 8,
        border: colors.border,
        background: colors.background,
        color: colors.color,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        transform: active && !disabled ? "translateY(-1px)" : "translateY(0)",
        opacity: disabled ? 0.62 : 1,
        transition: "background 150ms, border-color 150ms, transform 150ms",
      }}
    >
      {children}
    </button>
  );
}

function ScopeButton({ option, selected, disabled, onClick }) {
  const [active, setActive] = useState(false);
  const interactive = active && !disabled;

  return (
    <button
      type="button"
      data-testid={`calendar-quick-action-scope-${option.value}`}
      data-calendar-focus-ring="true"
      disabled={disabled}
      onClick={onClick}
      onPointerEnter={() => {
        if (!disabled) setActive(true);
      }}
      onPointerLeave={() => setActive(false)}
      onFocus={() => {
        if (!disabled) setActive(true);
      }}
      onBlur={() => setActive(false)}
      style={{
        minHeight: 36,
        padding: "7px 8px",
        borderRadius: 8,
        border: selected
          ? interactive
            ? "1px solid rgba(203,166,218,0.50)"
            : "1px solid rgba(203,166,218,0.38)"
          : interactive
            ? "1px solid rgba(255,255,255,0.15)"
            : "1px solid rgba(255,255,255,0.08)",
        background: selected
          ? interactive
            ? "rgba(203,166,218,0.22)"
            : "rgba(203,166,218,0.15)"
          : interactive
            ? "rgba(255,255,255,0.07)"
            : "rgba(255,255,255,0.035)",
        color: selected ? "#cba6da" : "#cdd6f4",
        fontSize: 10.5,
        lineHeight: 1.2,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        transform: interactive ? "translateY(-1px)" : "translateY(0)",
        opacity: disabled ? 0.62 : 1,
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms, opacity 150ms",
      }}
    >
      {option.label}
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
    function handlePointerDown(event) {
      if (ref.current?.contains(event.target)) return;
      quickActions.cancelPrompt();
    }
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      quickActions.cancelPrompt();
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
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
            <ScopeButton
              key={option.value}
              option={option}
              selected={selected}
              disabled={prompt.confirming}
              onClick={() => quickActions.setPromptScope(option.value)}
            />
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
