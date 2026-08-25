import { memo, useEffect, useRef, useState } from "react";
import {
  AnalyticsTriggerButton,
  OverflowMenu,
  PaletteTriggerButton,
  RefreshButton,
  ShellBrand,
  ShellTabs,
} from "./ShellHeaderChrome";
import { SystemStatusButton } from "./SystemStatusButton";
import { isDemoMode } from "../../demo/config";
import { resolveShellTabHotkey } from "../dashboard/dashboardShellModel";
import type { DashboardTab } from "../dashboard/dashboardShellModel";
import type { SystemStatusView } from "./SystemStatusButton";

export interface ShellHeaderProps {
  isMobile?: boolean;
  tab: DashboardTab;
  onTab: (tab: DashboardTab) => void;
  anyBlockingOverlayOpen?: boolean;
  analyticsOpen?: boolean;
  onOpenAnalytics: () => void;
  onOpenPalette: () => void;
  onOpenHistory: () => void;
  onOpenCalendar?: () => void;
  inboxUnreadSignalCount?: number;
  refreshing?: boolean;
  onQuickRefresh?: () => unknown;
  systemStatus?: SystemStatusView | null;
}

/**
 * ShellHeader — top chrome for the dashboard/inbox shell.
 * Tabs are hotkey-indexed (1 = dashboard, 2 = inbox). ⌘K opens the palette.
 * Sync now refreshes current dashboard data.
 *
 * Wrapped in React.memo: its callback props are now referentially stable from
 * DashboardShell, so the header chrome no longer re-renders on every dashboard
 * data refetch.
 */
function ShellHeader({
  isMobile = false,
  tab,
  onTab,
  anyBlockingOverlayOpen = false,
  analyticsOpen = false,
  onOpenAnalytics,
  onOpenPalette,
  onOpenHistory,
  inboxUnreadSignalCount = 0,
  refreshing,
  onQuickRefresh,
  systemStatus,
}: ShellHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const demoMode = isDemoMode();

  useEffect(() => {
    function onDoc(event: PointerEvent) {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // P3-27: route 1/2 tab hotkeys through the shared resolver so they are
      // suppressed while a blocking overlay (Customize / Analytics / History) is
      // open — otherwise the underlying tab switches behind the visible panel.
      const nextTab = resolveShellTabHotkey({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        editableTarget: event.target instanceof HTMLElement && (
          event.target.tagName === "INPUT"
          || event.target.tagName === "TEXTAREA"
          || event.target.isContentEditable
        ),
        anyBlockingOverlayOpen,
        activeTab: tab,
        notesEnabled: !isMobile && !demoMode,
      });
      if (nextTab) onTab(nextTab);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTab, anyBlockingOverlayOpen, demoMode, isMobile, tab]);

  return (
    <div
      data-testid={isMobile ? "shell-header-mobile" : "shell-header-desktop"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: isMobile ? "10px 12px" : "12px 20px",
        paddingTop: `calc(${isMobile ? "10px" : "12px"} + var(--sp-safe-top))`,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: "color-mix(in srgb, var(--sp-deep) 94%, transparent)",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      <ShellBrand isMobile={isMobile} />
      {demoMode ? (
        <span
          aria-label="Demo data: mocked data"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: isMobile ? 24 : 26,
            padding: isMobile ? "0 8px" : "0 10px",
            borderRadius: 999,
            border: "1px solid color-mix(in srgb, var(--sp-blue) 24%, transparent)",
            background: "color-mix(in srgb, var(--sp-blue) 8%, transparent)",
            color: "var(--sp-blue)",
            fontSize: isMobile ? 10 : 10.5,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: "var(--sp-blue)",
              boxShadow: "0 0 8px color-mix(in srgb, var(--sp-blue) 45%, transparent)",
            }}
          />
          Demo data
        </span>
      ) : null}
      {!isMobile && (
        <ShellTabs
          tab={tab}
          onTab={onTab}
          inboxUnreadSignalCount={inboxUnreadSignalCount}
          notesEnabled={!demoMode}
        />
      )}
      <div style={{ flex: 1 }} />
      {!isMobile && (
        <AnalyticsTriggerButton
          active={analyticsOpen}
          onOpenAnalytics={onOpenAnalytics}
        />
      )}
      {!isMobile && <PaletteTriggerButton onOpenPalette={onOpenPalette} />}
      <RefreshButton
        isMobile={isMobile}
        refreshing={refreshing}
        onQuickRefresh={onQuickRefresh}
      />
      <SystemStatusButton isMobile={isMobile} systemStatus={systemStatus} />
      <div ref={menuRef} style={{ position: "relative" }}>
        <OverflowMenu
          isMobile={isMobile}
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen((value) => !value)}
          onCloseMenu={() => setMenuOpen(false)}
          onOpenHistory={onOpenHistory}
          onOpenAnalytics={onOpenAnalytics}
        />
      </div>
    </div>
  );
}

export default memo(ShellHeader);
