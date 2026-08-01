import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  BarChart3,
  History,
  MoreHorizontal,
  Settings as SettingsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { Kbd } from "./Kbd";

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  kbd?: string | null;
  onClick: () => void;
  onPrepare?: () => void;
  danger?: boolean;
  isMobile: boolean;
}

function MenuItem({ icon, label, kbd, onClick, onPrepare, danger = false, isMobile }: MenuItemProps) {
  const Icon = icon;
  const [hover, setHover] = useState(false);

  return (
    <div
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onClick?.();
      }}
      onMouseEnter={() => {
        setHover(true);
        onPrepare?.();
      }}
      onFocus={onPrepare}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: isMobile ? "12px 12px" : "8px 10px",
        minHeight: isMobile ? "var(--sp-touch-min)" : undefined,
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 12,
        color: danger ? "var(--sp-rose)" : "var(--sp-text)",
        background: hover ? "rgba(255,255,255,0.04)" : "transparent",
        transition: "background 150ms",
      }}
    >
      <Icon size={12} color={danger ? "var(--sp-rose)" : "rgba(205,214,244,0.55)"} />
      <span style={{ flex: 1 }}>{label}</span>
      {kbd && <Kbd>{kbd}</Kbd>}
    </div>
  );
}

function MenuLink({ icon, label, to, onClick, isMobile }: {
  icon: LucideIcon;
  label: string;
  to: string;
  onClick: () => void;
  isMobile: boolean;
}) {
  const Icon = icon;
  const [hover, setHover] = useState(false);

  return (
    <Link
      to={to}
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: isMobile ? "12px 12px" : "8px 10px",
        minHeight: isMobile ? "var(--sp-touch-min)" : undefined,
        borderRadius: 6,
        textDecoration: "none",
        fontSize: 12,
        color: "var(--sp-text)",
        background: hover ? "rgba(255,255,255,0.04)" : "transparent",
        transition: "background 150ms",
      }}
    >
      <Icon size={12} color="rgba(205,214,244,0.55)" />
      <span style={{ flex: 1 }}>{label}</span>
    </Link>
  );
}

function OverflowButton({ open, onClick, isMobile, triggerRef }: {
  open: boolean;
  onClick: () => void;
  isMobile: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const active = hover || open;
  const lifted = hover && !pressed && !open;

  return (
    <button
      type="button"
      ref={triggerRef}
      aria-label="Open more actions"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        padding: isMobile ? 10 : 6,
        minWidth: isMobile ? 40 : undefined,
        minHeight: isMobile ? 40 : undefined,
        borderRadius: 8,
        border: `1px solid ${active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)"}`,
        background: active ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
        color: active ? "var(--sp-text)" : "rgba(205,214,244,0.75)",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms",
      }}
    >
      <MoreHorizontal size={isMobile ? 18 : 14} />
    </button>
  );
}

export interface OverflowMenuProps {
  isMobile: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onOpenHistory?: () => void;
  onOpenAnalytics?: () => void;
}

export function OverflowMenu({
  isMobile,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onOpenHistory,
  onOpenAnalytics,
}: OverflowMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest onCloseMenu in a ref so the keydown-listener effect below
  // doesn't need it in its dependency array — only `menuOpen` should control
  // when that effect (re)runs. Otherwise a non-memoized onCloseMenu identity
  // changing on an unrelated parent re-render would re-run the whole effect
  // and yank focus back to the first item mid-navigation.
  const onCloseMenuRef = useRef(onCloseMenu);
  useEffect(() => {
    onCloseMenuRef.current = onCloseMenu;
  });

  // Focus the first menuitem exactly once when the menu opens. Deliberately
  // depends only on menuOpen so it never re-fires from an unrelated re-render.
  useEffect(() => {
    if (!menuOpen) return;

    const menuNode = menuRef.current;
    const firstItem = menuNode?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();
  }, [menuOpen]);

  // Attach the keydown listener once per open/close cycle. Reads onCloseMenu
  // through the ref above so it always calls the latest callback without
  // needing to be in this effect's dependency array.
  useEffect(() => {
    if (!menuOpen) return undefined;

    const menuNode = menuRef.current;
    if (!menuNode) return undefined;

    const getItems = () => Array.from(menuNode.querySelectorAll<HTMLElement>('[role="menuitem"]'));

    const handleKeyDown = (event: KeyboardEvent) => {
      const currentItems = getItems();
      const currentIndex = document.activeElement instanceof HTMLElement
        ? currentItems.indexOf(document.activeElement)
        : -1;

      switch (event.key) {
        case "Escape": {
          event.preventDefault();
          onCloseMenuRef.current();
          triggerRef.current?.focus();
          break;
        }
        case "ArrowDown": {
          event.preventDefault();
          const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % currentItems.length;
          currentItems[nextIndex]?.focus();
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const prevIndex =
            currentIndex === -1
              ? currentItems.length - 1
              : (currentIndex - 1 + currentItems.length) % currentItems.length;
          currentItems[prevIndex]?.focus();
          break;
        }
        case "Home": {
          event.preventDefault();
          currentItems[0]?.focus();
          break;
        }
        case "End": {
          event.preventDefault();
          currentItems[currentItems.length - 1]?.focus();
          break;
        }
        case "Tab": {
          onCloseMenuRef.current();
          break;
        }
        default:
          break;
      }
    };

    menuNode.addEventListener("keydown", handleKeyDown);
    return () => menuNode.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  return (
    <>
      <OverflowButton
        open={menuOpen}
        onClick={onToggleMenu}
        isMobile={isMobile}
        triggerRef={triggerRef}
      />
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="More actions"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            minWidth: 210,
            padding: 6,
            borderRadius: 10,
            background: "var(--sp-panel)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
            zIndex: 50,
          }}
        >
          <MenuItem
            icon={History}
            label="Snapshots"
            kbd={isMobile ? null : "Y"}
            isMobile={isMobile}
            onClick={() => {
              onCloseMenu();
              onOpenHistory?.();
            }}
          />
          {isMobile && (
            <MenuItem
              icon={BarChart3}
              label="Analytics"
              isMobile={isMobile}
              onClick={() => {
                onCloseMenu();
                onOpenAnalytics?.();
              }}
            />
          )}
          <MenuLink
            icon={SettingsIcon}
            label="Settings"
            to="/settings"
            isMobile={isMobile}
            onClick={onCloseMenu}
          />
        </div>
      )}
    </>
  );
}
