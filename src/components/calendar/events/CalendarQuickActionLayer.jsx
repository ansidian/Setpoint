import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import Tooltip from "@/components/shared/Tooltip";
import {
  GOOGLE_EVENT_COLORS,
  googleEventColorIdForSourceHex,
} from "../../../../shared/calendar-event-colors.js";

const SCOPE_OPTIONS = [
  { value: "one", label: "Just this one" },
  { value: "following", label: "Upcoming only" },
  { value: "all", label: "All events" },
];

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function stop(event) {
  event.stopPropagation();
}

function menuStyle(menu) {
  const width = 220;
  const padding = 12;
  const height = 220;
  const left = Math.min(
    Math.max(padding, menu.x),
    Math.max(padding, window.innerWidth - width - padding),
  );
  const top = Math.min(
    Math.max(padding, menu.y),
    Math.max(padding, window.innerHeight - height - padding),
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

function focusableItems(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
}

function focusFirstMenuItem(container) {
  focusableItems(container)[0]?.focus({ preventScroll: true });
}

function colorDotItems(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll("[data-calendar-event-color-button='true']:not(:disabled)"));
}

function contextMenuFocusItems(container) {
  const dots = colorDotItems(container);
  return dots.length ? dots : focusableItems(container);
}

function focusMenuColor(container) {
  const dots = colorDotItems(container);
  if (!dots.length) {
    focusFirstMenuItem(container);
    return;
  }
  const selected = dots.find((element) => element.getAttribute("aria-pressed") === "true");
  (selected || dots[0])?.focus({ preventScroll: true });
}

function containTabFocus(event, container, itemResolver = focusableItems) {
  const items = itemResolver(container);
  if (!items.length) return;
  const first = items[0];
  const last = items.at(-1);
  const active = document.activeElement;

  if (!items.includes(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
    return;
  }

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
    return;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function normalizedHex(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function selectedEventColorId(event) {
  if (event?.colorId) return String(event.colorId);
  if (event?.sourceColorId) return String(event.sourceColorId);
  const visibleColor = normalizedHex(event?.color || event?.sourceColor);
  if (!visibleColor) return null;
  return googleEventColorIdForSourceHex(visibleColor);
}

function checkColorForDot(hex) {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#f8f5ff";
  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.58 ? "#16161e" : "#f8f5ff";
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

function ColorDotButton({ color, selected, disabled, onClick }) {
  const [active, setActive] = useState(false);
  const interactive = active && !disabled;
  const checkColor = checkColorForDot(color.hex);
  const tooltipLabel = color.label;

  const button = (
    <button
      type="button"
      data-testid={`calendar-event-color-${color.colorId}`}
      data-calendar-event-color-button="true"
      data-calendar-focus-ring="true"
      aria-label={tooltipLabel}
      aria-pressed={selected}
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
        width: 18,
        height: 18,
        padding: 0,
        borderRadius: 999,
        position: "relative",
        display: "grid",
        placeItems: "center",
        border: selected
          ? "2px solid color-mix(in srgb, var(--ea-accent, #cba6da) 82%, white 8%)"
          : interactive
            ? "2px solid rgba(255,255,255,0.42)"
            : "2px solid rgba(255,255,255,0.16)",
        background: color.hex,
        boxShadow: selected
          ? "0 0 0 2px rgba(22,22,30,0.95), 0 0 0 4px color-mix(in srgb, var(--ea-accent, #cba6da) 42%, transparent)"
          : interactive
            ? "0 0 0 2px rgba(255,255,255,0.06)"
            : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        transform: interactive ? "translateY(-1px)" : "translateY(0)",
        opacity: disabled ? 0.56 : 1,
        transition: "transform 150ms, border-color 150ms, box-shadow 150ms, opacity 150ms",
      }}
    >
      {selected ? (
        <Check
          data-testid={`calendar-event-color-check-${color.colorId}`}
          size={12}
          strokeWidth={3}
          aria-hidden="true"
          style={{
            color: checkColor,
            filter: checkColor === "#16161e"
              ? "drop-shadow(0 0 1px rgba(248,245,255,0.88))"
              : "drop-shadow(0 0 1px rgba(22,22,30,0.82))",
          }}
        />
      ) : null}
    </button>
  );

  return (
    <Tooltip
      text={tooltipLabel}
      side="top"
      sideOffset={24}
      delay={250}
      closeDelay={0}
      disableHoverablePopup
      contentStyle={{ pointerEvents: "none" }}
      style={{ width: 18, height: 18 }}
    >
      {button}
    </Tooltip>
  );
}

function ColorGrid({ menu, quickActions }) {
  const selectedColorId = selectedEventColorId(menu.event);
  return (
    <div
      data-testid="calendar-event-color-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, 18px)",
        gap: "8px 9px",
        padding: "2px 4px 3px",
      }}
    >
      {GOOGLE_EVENT_COLORS.map((color) => (
        <ColorDotButton
          key={color.colorId}
          color={color}
          selected={selectedColorId === color.colorId}
          disabled={menu.busy}
          onClick={() => quickActions.chooseEventColor(color.colorId)}
        />
      ))}
    </div>
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
      if (event.key === "Tab") {
        containTabFocus(event, ref.current, menu.confirm ? focusableItems : contextMenuFocusItems);
        return;
      }
      if (event.key === "Escape") {
        quickActions.closeContextMenu();
        event.preventDefault();
        event.stopPropagation();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    window.queueMicrotask(() => {
      if (menu.confirm) {
        focusFirstMenuItem(ref.current);
      } else {
        focusMenuColor(ref.current);
      }
    });
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
        <>
          <ActionButton disabled={menu.busy} onClick={quickActions.copyContextEvent} testId="calendar-event-context-copy">
            Copy
          </ActionButton>
          <ActionButton disabled={menu.busy} onClick={quickActions.duplicateContextEvent} testId="calendar-event-context-duplicate">
            Duplicate
          </ActionButton>
          <ActionButton tone="danger" disabled={menu.busy} onClick={quickActions.requestDelete} testId="calendar-event-context-delete">
            Delete
          </ActionButton>
          <div
            aria-hidden="true"
            style={{
              height: 1,
              margin: "2px 2px",
              background: "rgba(255,255,255,0.08)",
            }}
          />
          <ColorGrid menu={menu} quickActions={quickActions} />
        </>
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
  const title = prompt.kind === "delete"
    ? "Delete recurring event"
    : prompt.kind === "color"
      ? "Color recurring event"
      : "Move recurring event";

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
