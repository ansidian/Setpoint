import { createPortal } from "react-dom";
import { useRef, useState } from "react";
import { Check } from "lucide-react";
import Tooltip from "@/components/shared/Tooltip";
import { GOOGLE_EVENT_COLORS } from "../../../../shared/calendar-event-colors";
import useDismissablePortal from "../../../hooks/useDismissablePortal";
import {
  containTabFocus,
  contextMenuFocusItems,
  focusableItems,
  focusFirstMenuItem,
  focusMenuColor,
  menuStyle,
} from "./quickActionMenuLayout.js";
import { checkColorForDot, selectedEventColorId } from "./quickActionColorModel.js";

const SCOPE_OPTIONS = [
  { value: "one", label: "Just this one" },
  { value: "following", label: "Upcoming only" },
  { value: "all", label: "All events" },
];

function stop(event) {
  event.stopPropagation();
}

function actionButtonColors(tone, active) {
  if (tone === "danger") {
    return {
      border: active ? "1px solid color-mix(in srgb, var(--sp-rose) 52%, transparent)" : "1px solid color-mix(in srgb, var(--sp-rose) 34%, transparent)",
      background: active ? "color-mix(in srgb, var(--sp-rose) 20%, transparent)" : "color-mix(in srgb, var(--sp-rose) 14%, transparent)",
      color: "var(--sp-rose)",
    };
  }
  if (tone === "primary") {
    return {
      border: active ? "1px solid color-mix(in srgb, var(--sp-accent) 42%, transparent)" : "1px solid rgba(255,255,255,0.08)",
      background: active ? "color-mix(in srgb, var(--sp-accent) 22%, transparent)" : "color-mix(in srgb, var(--sp-accent) 16%, transparent)",
      color: "var(--sp-accent)",
    };
  }
  return {
    border: active ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(255,255,255,0.08)",
    background: active ? "rgba(255,255,255,0.075)" : "rgba(255,255,255,0.04)",
    color: "var(--sp-text)",
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

function ColorDotButton({ color, selected, disabled, onClick, scopeCount = 1 }) {
  const [active, setActive] = useState(false);
  const interactive = active && !disabled;
  const checkColor = checkColorForDot(color.hex);
  const tooltipLabel = scopeCount > 1 ? `${color.label} for ${scopeCount} events` : color.label;

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
          ? "2px solid color-mix(in srgb, var(--ea-accent, var(--sp-accent)) 82%, white 8%)"
          : interactive
            ? "2px solid rgba(255,255,255,0.42)"
            : "2px solid rgba(255,255,255,0.16)",
        background: color.hex,
        boxShadow: selected
          ? "0 0 0 2px color-mix(in srgb, var(--sp-panel) 95%, transparent), 0 0 0 4px color-mix(in srgb, var(--ea-accent, var(--sp-accent)) 42%, transparent)"
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
              : "drop-shadow(0 0 1px color-mix(in srgb, var(--sp-panel) 82%, transparent))",
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
  const scopeCount = menu.actionScope?.kind === "selection" ? menu.actionScope.events?.length || 1 : 1;
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
          scopeCount={scopeCount}
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
            ? "1px solid color-mix(in srgb, var(--sp-accent) 50%, transparent)"
            : "1px solid color-mix(in srgb, var(--sp-accent) 38%, transparent)"
          : interactive
            ? "1px solid rgba(255,255,255,0.15)"
            : "1px solid rgba(255,255,255,0.08)",
        background: selected
          ? interactive
            ? "color-mix(in srgb, var(--sp-accent) 22%, transparent)"
            : "color-mix(in srgb, var(--sp-accent) 15%, transparent)"
          : interactive
            ? "rgba(255,255,255,0.07)"
            : "rgba(255,255,255,0.035)",
        color: selected ? "var(--sp-accent)" : "var(--sp-text)",
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

  useDismissablePortal({
    ref,
    active: !!menu,
    onDismiss: quickActions.closeContextMenu,
    onTabKey: (event) => containTabFocus(
      event,
      ref.current,
      menu?.confirm ? focusableItems : contextMenuFocusItems,
    ),
    onActivate: () => {
      if (menu?.confirm) {
        focusFirstMenuItem(ref.current);
      } else {
        focusMenuColor(ref.current);
      }
    },
    activateKey: menu,
  });

  if (!menu) return null;
  const pos = menuStyle(menu);
  const scopedEventCount = menu.actionScope?.kind === "selection" ? menu.actionScope.events?.length || 1 : 1;
  const copyLabel = scopedEventCount > 1 ? `Copy ${scopedEventCount} events` : "Copy";
  const deleteLabel = scopedEventCount > 1 ? `Delete ${scopedEventCount} events` : "Delete";
  const confirmDeleteLabel = scopedEventCount > 1 ? `Delete ${scopedEventCount} events` : "Confirm delete";
  const confirmDeleteQuestion = scopedEventCount > 1 ? `Delete ${scopedEventCount} events?` : "Delete this event?";

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
        background: "var(--sp-panel)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        isolation: "isolate",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {menu.error ? (
        <div data-testid="calendar-quick-action-error" style={{ color: "var(--sp-rose)", fontSize: 11, lineHeight: 1.35, padding: "4px 6px" }}>
          {menu.error}
        </div>
      ) : null}
      {menu.confirm ? (
        <>
          <div style={{ color: "rgba(205,214,244,0.68)", fontSize: 11, lineHeight: 1.4, padding: "4px 6px" }}>
            {confirmDeleteQuestion}
          </div>
          <ActionButton tone="danger" disabled={menu.busy} onClick={quickActions.confirmContextDelete} testId="calendar-event-context-confirm-delete">
            {menu.busy ? "Deleting..." : confirmDeleteLabel}
          </ActionButton>
          <ActionButton disabled={menu.busy} onClick={quickActions.closeContextMenu}>
            Cancel
          </ActionButton>
        </>
      ) : (
        <>
          <ActionButton disabled={menu.busy} onClick={quickActions.copyContextEvent} testId="calendar-event-context-copy">
            {copyLabel}
          </ActionButton>
          <ActionButton disabled={menu.busy} onClick={quickActions.duplicateContextEvent} testId="calendar-event-context-duplicate">
            Duplicate
          </ActionButton>
          <ActionButton tone="danger" disabled={menu.busy} onClick={quickActions.requestDelete} testId="calendar-event-context-delete">
            {deleteLabel}
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

  useDismissablePortal({
    ref,
    active: !!prompt,
    onDismiss: quickActions.cancelPrompt,
  });

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
        background: "var(--sp-panel)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        isolation: "isolate",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--sp-text)" }}>{title}</div>
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
        <div data-testid="calendar-quick-action-error" style={{ color: "var(--sp-rose)", fontSize: 11, lineHeight: 1.35 }}>
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
    ? "var(--sp-rose)"
    : quickActions.status.tone === "success"
      ? "var(--sp-green)"
      : "var(--sp-accent)";

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
        background: "var(--sp-panel)",
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
