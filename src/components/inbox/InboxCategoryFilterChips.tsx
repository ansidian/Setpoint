import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEventHandler, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import {
  formatInboxCategoryLabel,
  partitionInboxCategoryFilters,
} from "./InboxCategoryFilterChipsModel";
import type { InboxCategoryFilter } from "./inboxTypes";

const CHIP_BASE_STYLE: CSSProperties = {
  minWidth: 0,
  maxWidth: 132,
  height: 26,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  borderRadius: 999,
  padding: "0 9px",
  fontFamily: "inherit",
  fontSize: 10,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "background 160ms, border-color 160ms, color 160ms, transform 160ms",
};

function chipStyle({ active, accent, hovered = false, focused = false }: {
  active: boolean;
  accent: string;
  hovered?: boolean;
  focused?: boolean;
}): CSSProperties {
  return {
    ...CHIP_BASE_STYLE,
    border: `1px solid ${active ? `${accent}48` : hovered || focused ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)"}`,
    background: active ? `${accent}18` : hovered || focused ? "rgba(255,255,255,0.055)" : "rgba(255,255,255,0.03)",
    color: active ? "#fff" : hovered || focused ? "rgba(205,214,244,0.86)" : "rgba(205,214,244,0.66)",
    transform: hovered ? "translateY(-1px)" : "translateY(0)",
  };
}

function CategoryChip({
  active = false,
  accent,
  children,
  onClick,
  buttonRef,
  ariaLabel,
  ariaExpanded,
  ariaControls,
}: {
  active?: boolean;
  accent: string;
  children: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  ariaLabel: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={chipStyle({ active, accent, hovered, focused })}
    >
      {children}
    </button>
  );
}

function CategoryLabel({ children }: { children: ReactNode }) {
  return (
    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
      {children}
    </span>
  );
}

function CategoryCount({ active = false, accent = "#cba6da", children, muted = false }: {
  active?: boolean;
  accent?: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      style={{
        minWidth: 15,
        height: 15,
        padding: "0 4px",
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: muted ? "rgba(255,255,255,0.045)" : active ? `${accent}24` : "rgba(255,255,255,0.055)",
        color: muted ? "var(--color-text-faint)" : active ? accent : "var(--color-text-faint)",
        fontSize: 8.5,
        fontWeight: 750,
        fontVariantNumeric: "tabular-nums",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

type MenuPosition = { top: number; left: number; minWidth: number };

function useMenuPosition(open: boolean, triggerRef: RefObject<HTMLButtonElement | null>) {
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 236)),
      minWidth: Math.max(180, rect.width),
    });
  }, [triggerRef]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  return position;
}

export default function InboxCategoryFilterChips({
  accent,
  categories,
  activeCategory = "__all",
  onChange,
}: {
  accent: string;
  categories: InboxCategoryFilter[];
  activeCategory?: string;
  onChange?: (category: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = "inbox-category-filter-more-menu";
  const partition = useMemo(() => (
    partitionInboxCategoryFilters(categories, { activeCategory })
  ), [categories, activeCategory]);
  const position = useMenuPosition(menuOpen, triggerRef);
  const hiddenActive = !!partition.activeHiddenCategory;

  useEffect(() => {
    if (!menuOpen) return undefined;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && triggerRef.current?.contains(target)) return;
      if (target && menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (!categories?.length) return null;

  const selectCategory = (category: string) => {
    if (category === activeCategory) return;
    onChange?.(category);
  };

  const activeHiddenCategory = partition.activeHiddenCategory;
  const triggerLabel = activeHiddenCategory
    ? `${formatInboxCategoryLabel(activeHiddenCategory.category)} · More`
    : "More";

  return (
    <div
      data-testid="inbox-category-filter-strip"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        overflowX: "hidden",
        minWidth: 0,
      }}
    >
      <CategoryChip
        active={activeCategory === "__all"}
        accent={accent}
        onClick={() => selectCategory("__all")}
        ariaLabel="All"
      >
        <CategoryLabel>All</CategoryLabel>
      </CategoryChip>
      {partition.visible.map((entry) => {
        const label = formatInboxCategoryLabel(entry.category);
        const active = activeCategory === entry.category;
        return (
          <CategoryChip
            key={entry.category}
            active={active}
            accent={accent}
            onClick={() => selectCategory(entry.category)}
            ariaLabel={`${label} ${entry.count}`}
          >
            <CategoryLabel>{label}</CategoryLabel>
            <CategoryCount active={active} accent={accent}>{entry.count}</CategoryCount>
          </CategoryChip>
        );
      })}
      {partition.hidden.length > 0 && (
        <CategoryChip
          active={hiddenActive}
          accent={accent}
          onClick={() => setMenuOpen((value) => !value)}
          buttonRef={triggerRef}
          ariaLabel={hiddenActive ? triggerLabel : `More ${partition.hiddenCount}`}
          ariaExpanded={menuOpen}
          ariaControls={menuId}
        >
          <CategoryLabel>{triggerLabel}</CategoryLabel>
          {hiddenActive ? <ChevronDown size={11} /> : <CategoryCount muted>{partition.hiddenCount}</CategoryCount>}
        </CategoryChip>
      )}
      {menuOpen && position && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="More inbox categories"
          style={{
            position: "fixed",
            top: position.top,
            left: position.left,
            minWidth: position.minWidth,
            maxWidth: 236,
            maxHeight: 280,
            overflowY: "auto",
            overscrollBehavior: "contain",
            isolation: "isolate",
            zIndex: 1200,
            padding: 6,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "var(--sp-panel)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
          }}
        >
          {partition.hidden.map((entry) => {
            const label = formatInboxCategoryLabel(entry.category);
            const active = activeCategory === entry.category;
            return (
              <button
                key={entry.category}
                type="button"
                role="menuitemradio"
                aria-label={`${label} ${entry.count}`}
                aria-checked={active}
                onClick={() => {
                  selectCategory(entry.category);
                  setMenuOpen(false);
                }}
                style={{
                  width: "100%",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 9px",
                  borderRadius: 8,
                  border: `1px solid ${active ? `${accent}36` : "transparent"}`,
                  background: active ? `${accent}14` : "transparent",
                  color: active ? "#fff" : "rgba(205,214,244,0.78)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 11,
                  textAlign: "left",
                }}
              >
                <span style={{ width: 12, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>
                  {active && <Check size={12} color={accent} />}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {label}
                </span>
                <span
                  style={{
                    color: active ? accent : "var(--color-text-faint)",
                    fontSize: 10,
                    fontWeight: 750,
                    fontVariantNumeric: "tabular-nums",
                    flexShrink: 0,
                  }}
                >
                  {entry.count}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
