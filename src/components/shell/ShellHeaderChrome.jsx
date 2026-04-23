import { useState } from "react";
import {
  Sparkles,
  LayoutList,
  Inbox,
  Search,
  RefreshCw,
  MoreHorizontal,
  History,
  Settings as SettingsIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

export function Kbd({ children }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 16,
        height: 16,
        padding: "0 4px",
        fontSize: 10,
        fontFamily: "Fira Code, ui-monospace, monospace",
        fontWeight: 500,
        color: "rgba(205,214,244,0.55)",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 4,
        letterSpacing: 0,
      }}
    >
      {children}
    </kbd>
  );
}

export function ShellBrand({ isMobile }) {
  return isMobile ? (
    <img
      src="/ea-dashboard-mark-v3.svg"
      alt="EA Dashboard"
      style={{ height: 20, width: 20, flexShrink: 0 }}
    />
  ) : (
    <img
      src="/ea-dashboard-header-logo-compact-v3.svg"
      alt="EA Dashboard"
      style={{ height: 24, flexShrink: 0 }}
    />
  );
}

export function ShellTabs({ isMobile, tab, onTab, liveUnreadCount }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        padding: 3,
        borderRadius: 10,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.05)",
        minWidth: 0,
      }}
    >
      {["dashboard", "inbox"].map((tabKey) => {
        const showUnread = tabKey === "inbox" && liveUnreadCount > 0;
        return (
          <button
            key={tabKey}
            type="button"
            onClick={() => onTab(tabKey)}
            style={{
              padding: isMobile ? "7px 10px" : "5px 12px",
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              fontSize: isMobile ? 10.5 : 11.5,
              fontWeight: 600,
              letterSpacing: 0.3,
              fontFamily: "inherit",
              background: tab === tabKey ? "rgba(255,255,255,0.06)" : "transparent",
              color: tab === tabKey ? "#cdd6f4" : "rgba(205,214,244,0.45)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: "all 150ms",
              minWidth: 0,
            }}
          >
            {tabKey === "dashboard"
              ? <LayoutList size={isMobile ? 11 : 12} />
              : <Inbox size={isMobile ? 11 : 12} />}
            {showUnread && (
              <span
                title={`${liveUnreadCount} untriaged`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 16,
                  height: 16,
                  padding: "0 5px",
                  fontSize: 9.5,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  color: "#89b4fa",
                  background: "rgba(137,180,250,0.14)",
                  border: "1px solid rgba(137,180,250,0.32)",
                  borderRadius: 99,
                  letterSpacing: 0,
                }}
              >
                {liveUnreadCount > 99 ? "99+" : liveUnreadCount}
              </span>
            )}
            <span>{tabKey === "dashboard" ? "Dashboard" : "Inbox"}</span>
            {!isMobile && <Kbd>{tabKey === "dashboard" ? "1" : "2"}</Kbd>}
          </button>
        );
      })}
    </div>
  );
}

export function PaletteTriggerButton({ onOpenPalette }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lifted = hover && !pressed;

  return (
    <button
      type="button"
      aria-label="Open command palette"
      onClick={onOpenPalette}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      title="Command palette (⌘K)"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 8,
        fontSize: 11,
        fontFamily: "inherit",
        letterSpacing: 0.2,
        fontWeight: 500,
        background: hover ? "rgba(255,255,255,0.05)" : "transparent",
        color: hover ? "rgba(205,214,244,0.9)" : "rgba(205,214,244,0.6)",
        border: `1px solid ${hover ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)"}`,
        cursor: "pointer",
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms",
      }}
    >
      <Search size={11} />
      <span>Jump to anything</span>
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
    </button>
  );
}

function StatusText({ children, color = "rgba(245,247,255,0.9)", maxWidth = 132, weight = 600 }) {
  if (!children) return null;

  return (
    <span
      style={{
        minWidth: 0,
        maxWidth,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: 12,
        fontWeight: weight,
        color,
        lineHeight: 1.2,
        letterSpacing: 0,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </span>
  );
}

export function BriefingStatusPill({ accent, briefingStatus }) {
  if (!briefingStatus) return null;

  const toneColor = briefingStatus.toneColor || accent;
  const activityToneColor = briefingStatus.activityToneColor || "#cdd6f4";
  const activityDisplayLabel = briefingStatus.activityShortLabel || briefingStatus.activityLabel;
  const primaryLabel = [
    briefingStatus.sourceLabel || briefingStatus.label,
    briefingStatus.ageLabel,
  ].filter(Boolean).join(" · ");
  const title = [
    briefingStatus.label,
    briefingStatus.headline,
    briefingStatus.activityLabel,
    briefingStatus.detail,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-testid="shell-header-briefing-status"
      title={title}
      aria-label={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        minWidth: 0,
        maxWidth: 372,
        minHeight: 30,
        padding: "5px 10px",
        borderRadius: 10,
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.025))",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: toneColor,
          boxShadow: `0 0 8px ${toneColor}`,
          flexShrink: 0,
        }}
      />
      <StatusText maxWidth={142}>{primaryLabel}</StatusText>
      {activityDisplayLabel ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            maxWidth: 92,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            padding: "3px 7px",
            borderRadius: 9999,
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: 0,
            color: activityToneColor,
            background: `${activityToneColor}14`,
            border: `1px solid ${activityToneColor}30`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {activityDisplayLabel}
        </span>
      ) : null}
      {briefingStatus.nextLabel ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            minWidth: 0,
            paddingLeft: activityDisplayLabel ? 0 : 2,
            color: "rgba(205,214,244,0.52)",
            flex: "0 1 auto",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 1,
              height: 14,
              background: "rgba(255,255,255,0.08)",
              flexShrink: 0,
            }}
          />
          <StatusText color="rgba(205,214,244,0.58)" maxWidth={84} weight={500}>
            {briefingStatus.nextLabel}
          </StatusText>
        </span>
      ) : null}
    </div>
  );
}

function MenuItem({ icon, label, kbd, onClick, danger }) {
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
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 12,
        color: danger ? "#f38ba8" : "#cdd6f4",
        background: hover ? "rgba(255,255,255,0.04)" : "transparent",
        transition: "background 150ms",
      }}
    >
      <Icon size={12} color={danger ? "#f38ba8" : "rgba(205,214,244,0.55)"} />
      <span style={{ flex: 1 }}>{label}</span>
      {kbd && <Kbd>{kbd}</Kbd>}
    </div>
  );
}

function MenuLink({ icon, label, to, onClick }) {
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
        padding: "8px 10px",
        borderRadius: 6,
        textDecoration: "none",
        fontSize: 12,
        color: "#cdd6f4",
        background: hover ? "rgba(255,255,255,0.04)" : "transparent",
        transition: "background 150ms",
      }}
    >
      <Icon size={12} color="rgba(205,214,244,0.55)" />
      <span style={{ flex: 1 }}>{label}</span>
    </Link>
  );
}

function ConfirmGenerateButton({ accent, onClick }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lifted = hover && !pressed;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        padding: "5px 10px",
        borderRadius: 6,
        border: "none",
        background: accent,
        color: "#0b0b13",
        fontFamily: "inherit",
        fontWeight: 600,
        fontSize: 11,
        cursor: "pointer",
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        boxShadow: lifted ? `0 6px 18px ${accent}59` : "none",
        filter: lifted ? "brightness(1.06)" : "none",
        transition: "transform 150ms, box-shadow 150ms, filter 150ms",
      }}
    >
      Generate
    </button>
  );
}

function ConfirmCancelButton({ onClick }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lifted = hover && !pressed;

  return (
    <button
      type="button"
      aria-label="Cancel full generation"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        padding: "5px 10px",
        borderRadius: 6,
        border: `1px solid ${hover ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)"}`,
        background: hover ? "rgba(255,255,255,0.06)" : "transparent",
        color: hover ? "rgba(205,214,244,0.9)" : "rgba(205,214,244,0.7)",
        fontFamily: "inherit",
        fontSize: 11,
        cursor: "pointer",
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms",
      }}
    >
      Cancel
    </button>
  );
}

function OverflowButton({ open, onClick }) {
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
        padding: 6,
        borderRadius: 8,
        border: `1px solid ${active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)"}`,
        background: active ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
        color: active ? "#cdd6f4" : "rgba(205,214,244,0.75)",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms",
      }}
    >
      <MoreHorizontal size={14} />
    </button>
  );
}

export function RefreshButton({
  accent,
  isMobile = false,
  refreshHold,
  refreshing,
  generating,
  holdPct,
  onQuickRefresh,
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const busy = refreshing || generating;
  const holding = holdPct > 0;
  const lifted = hover && !pressed && !busy && !holding;

  return (
    <button
      type="button"
      aria-label="Refresh dashboard"
      onPointerDown={(event) => {
        setPressed(true);
        refreshHold?.startHold?.(event);
      }}
      onPointerUp={(event) => {
        setPressed(false);
        refreshHold?.endHold?.(event);
      }}
      onPointerLeave={() => {
        setPressed(false);
        setHover(false);
        refreshHold?.endHold?.(true);
      }}
      onMouseEnter={() => setHover(true)}
      onClick={() => {
        if (!holdPct) onQuickRefresh?.();
      }}
      disabled={busy}
      style={{
        position: "relative",
        overflow: "hidden",
        padding: isMobile ? "7px 9px" : "5px 10px",
        borderRadius: 8,
        border: `1px solid ${hover && !busy ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)"}`,
        background: hover && !busy ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
        color: hover && !busy ? "#cdd6f4" : "rgba(205,214,244,0.85)",
        fontFamily: "inherit",
        fontSize: isMobile ? 10.5 : 11,
        fontWeight: 500,
        letterSpacing: 0.2,
        cursor: refreshing ? "wait" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        opacity: busy ? 0.6 : 1,
        transform: lifted ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms",
      }}
      title={isMobile ? "Tap to refresh · Hold for full AI briefing" : "Tap to refresh · Hold for full AI briefing · R"}
    >
      {holdPct > 0 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${holdPct}%`,
            background: `linear-gradient(90deg, ${accent}30, ${accent}15)`,
            borderRadius: 8,
          }}
        />
      )}
      <RefreshCw
        size={isMobile ? 10 : 11}
        style={{ animation: refreshing ? "spin 0.8s linear infinite" : "none" }}
      />
      <span style={{ position: "relative" }}>
        {refreshing ? "Refreshing…" : holdPct > 0 ? "Hold…" : "Refresh"}
      </span>
      {!isMobile && <Kbd>R</Kbd>}
    </button>
  );
}

export function OverflowMenu({
  isMobile,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onOpenHistory,
  onOpenCalendar,
  onOpenCustomize,
}) {
  return (
    <>
      <OverflowButton open={menuOpen} onClick={onToggleMenu} />
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
            label="Briefing history"
            kbd={isMobile ? null : "H"}
            onClick={() => {
              onCloseMenu();
              onOpenHistory?.();
            }}
          />
          {!isMobile && (
            <MenuItem
              icon={LayoutList}
              label="Calendar"
              kbd="C"
              onClick={() => {
                onCloseMenu();
                onOpenCalendar?.();
              }}
            />
          )}
          <MenuItem
            icon={SettingsIcon}
            label="Customize"
            onClick={() => {
              onCloseMenu();
              onOpenCustomize?.();
            }}
          />
          <MenuLink
            icon={SettingsIcon}
            label="Settings"
            to="/settings"
            onClick={onCloseMenu}
          />
        </div>
      )}
    </>
  );
}

export function ConfirmGenerateToast({ accent, confirming, onFullGenerate, onCancel }) {
  if (!confirming) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 64,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "10px 14px",
        borderRadius: 10,
        background: "#16161e",
        border: `1px solid ${accent}40`,
        boxShadow: `0 0 40px ${accent}30`,
        display: "flex",
        alignItems: "center",
        gap: 10,
        zIndex: 60,
        fontSize: 12,
      }}
    >
      <Sparkles size={13} color={accent} />
      Generate a fresh AI briefing?
      <ConfirmGenerateButton accent={accent} onClick={onFullGenerate} />
      <ConfirmCancelButton onClick={onCancel} />
    </div>
  );
}
