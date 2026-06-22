import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import useDismissablePortal from "../../../../hooks/useDismissablePortal.js";
import { clampMenuPosition } from "../../events/quickActionMenuLayout.js";

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
  return {
    border: active ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(255,255,255,0.08)",
    background: active ? "rgba(255,255,255,0.075)" : "rgba(255,255,255,0.04)",
    color: "var(--sp-text)",
  };
}

function MenuButton({ item, disabled, onSelect }) {
  const [active, setActive] = useState(false);
  const colors = actionButtonColors(item.tone, active && !disabled);

  return (
    <button
      type="button"
      role="menuitem"
      data-testid={item.testId}
      data-calendar-focus-ring="true"
      disabled={disabled}
      onClick={onSelect}
      onPointerEnter={() => {
        if (!disabled) setActive(true);
      }}
      onPointerLeave={() => setActive(false)}
      onFocus={() => {
        if (!disabled) setActive(true);
      }}
      onBlur={() => setActive(false)}
      style={{
        minHeight: 32,
        padding: "0 10px",
        borderRadius: 8,
        border: colors.border,
        background: colors.background,
        color: colors.color,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        transform: active && !disabled ? "translateY(-1px)" : "translateY(0)",
        opacity: disabled ? 0.62 : 1,
        transition: "background 150ms, border-color 150ms, transform 150ms, opacity 150ms",
      }}
    >
      {item.label}
    </button>
  );
}

function Separator() {
  return (
    <div
      aria-hidden="true"
      style={{
        height: 1,
        background: "rgba(255,255,255,0.08)",
        margin: "2px 1px",
      }}
    />
  );
}

function ContextMenu({ quickActions }) {
  const menu = quickActions.contextMenu;
  const ref = useRef(null);

  // Outside-pointerdown + capture-phase Escape dismissal, shared with the
  // calendar event quick-action menu (exact-match contract: document/bubble
  // pointerdown, document/capture Escape with preventDefault + stopPropagation).
  useDismissablePortal({
    ref,
    active: !!menu,
    onDismiss: quickActions.closeContextMenu,
  });

  if (!menu) return null;
  const pos = clampMenuPosition({ x: menu.x, y: menu.y, bottomReserve: 170 });
  const busy = !!menu.busy;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-testid="calendar-deadline-context-menu"
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
      {quickActions.contextMenuTitle ? (
        <div style={{ color: "var(--color-text-faint)", fontSize: 10, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", padding: "3px 6px 1px" }}>
          {quickActions.contextMenuTitle}
        </div>
      ) : null}
      {menu.error ? (
        <div data-testid="calendar-deadline-quick-action-error" style={{ color: "var(--sp-rose)", fontSize: 11, lineHeight: 1.35, padding: "4px 6px" }}>
          {menu.error}
        </div>
      ) : null}
      {menu.confirm ? (
        <>
          <div style={{ color: "rgba(205,214,244,0.68)", fontSize: 11, lineHeight: 1.4, padding: "4px 6px" }}>
            Delete this deadline?
          </div>
          <MenuButton
            item={{ label: busy ? "Deleting..." : "Confirm delete", tone: "danger", testId: "calendar-deadline-context-confirm-delete" }}
            disabled={busy}
            onSelect={quickActions.confirmContextDelete}
          />
          <MenuButton
            item={{ label: "Cancel" }}
            disabled={busy}
            onSelect={quickActions.closeContextMenu}
          />
        </>
      ) : (
        quickActions.menuItems.map((item, index) => (
          item.type === "separator" ? (
            <Separator key={`sep-${index}`} />
          ) : (
            <MenuButton
              key={item.id || index}
              item={item}
              disabled={busy || item.disabled}
              onSelect={() => {
                item.onSelect?.();
                if (item.id !== "delete") quickActions.closeContextMenu();
              }}
            />
          )
        ))
      )}
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
      data-testid="calendar-deadline-quick-action-status"
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

export default function DeadlineQuickActionLayer({ quickActions }) {
  if (!quickActions) return null;
  return (
    <>
      <Status quickActions={quickActions} />
      <ContextMenu quickActions={quickActions} />
    </>
  );
}
