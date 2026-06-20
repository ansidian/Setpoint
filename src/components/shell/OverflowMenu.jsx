import { useState } from "react";
import {
  BarChart3,
  History,
  MoreHorizontal,
  Settings as SettingsIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Kbd } from "./Kbd.jsx";

function MenuItem({ icon, label, kbd, onClick, onPrepare, danger, isMobile }) {
  const Icon = icon;
  const [hover, setHover] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
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
        minHeight: isMobile ? 44 : undefined,
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 12,
        color: danger ? "#f38ba8" : "#cdd6f4",
        background: hover ? "rgba(255,255,255,0.04)" : "transparent",
        touchAction: "manipulation",
        transition: "background 150ms",
      }}
    >
      <Icon size={12} color={danger ? "#f38ba8" : "rgba(205,214,244,0.55)"} />
      <span style={{ flex: 1 }}>{label}</span>
      {kbd && <Kbd>{kbd}</Kbd>}
    </div>
  );
}

function MenuLink({ icon, label, to, onClick, isMobile }) {
  const Icon = icon;
  const [hover, setHover] = useState(false);

  return (
    <Link
      to={to}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: isMobile ? "12px 12px" : "8px 10px",
        minHeight: isMobile ? 44 : undefined,
        borderRadius: 6,
        textDecoration: "none",
        fontSize: 12,
        color: "#cdd6f4",
        background: hover ? "rgba(255,255,255,0.04)" : "transparent",
        touchAction: "manipulation",
        transition: "background 150ms",
      }}
    >
      <Icon size={12} color="rgba(205,214,244,0.55)" />
      <span style={{ flex: 1 }}>{label}</span>
    </Link>
  );
}

function OverflowButton({ open, onClick, isMobile }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const active = hover || open;
  const lifted = hover && !pressed && !open;

  return (
    <button
      type="button"
      aria-label="Open more actions"
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
        color: active ? "#cdd6f4" : "rgba(205,214,244,0.75)",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        touchAction: "manipulation",
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms",
      }}
    >
      <MoreHorizontal size={isMobile ? 18 : 14} />
    </button>
  );
}

export function OverflowMenu({
  isMobile,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onOpenHistory,
  onOpenAnalytics,
}) {
  return (
    <>
      <OverflowButton open={menuOpen} onClick={onToggleMenu} isMobile={isMobile} />
      {menuOpen && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            minWidth: 210,
            padding: 6,
            borderRadius: 10,
            background: "#16161e",
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
