import { useEffect, useRef, useState } from "react";
import {
  AnalyticsTriggerButton,
  OverflowMenu,
  PaletteTriggerButton,
  RefreshButton,
  ShellBrand,
  ShellTabs,
} from "./ShellHeaderChrome";
import { SystemStatusButton } from "./SystemStatusButton.jsx";

/**
 * ShellHeader — top chrome for the dashboard/inbox shell.
 * Tabs are hotkey-indexed (1 = dashboard, 2 = inbox). ⌘K opens the palette.
 * Sync now refreshes current dashboard data.
 */
export default function ShellHeader({
  isMobile = false,
  tab,
  onTab,
  analyticsOpen = false,
  onOpenAnalytics,
  onOpenPalette,
  onOpenCustomize,
  onOpenHistory,
  onOpenCalendar,
  inboxUnreadSignalCount = 0,
  refreshing,
  onQuickRefresh,
  systemStatus,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onDoc(event) {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (
        event.target.tagName === "INPUT"
        || event.target.tagName === "TEXTAREA"
        || event.target.isContentEditable
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "1") onTab("dashboard");
      if (event.key === "2") onTab("inbox");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTab]);

  return (
    <div
      data-testid={isMobile ? "shell-header-mobile" : "shell-header-desktop"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: isMobile ? "10px 12px" : "12px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(11,11,19,0.94)",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      <ShellBrand isMobile={isMobile} />
      <ShellTabs
        isMobile={isMobile}
        tab={tab}
        onTab={onTab}
        inboxUnreadSignalCount={inboxUnreadSignalCount}
      />
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
          onOpenCalendar={onOpenCalendar}
          onOpenAnalytics={onOpenAnalytics}
          onOpenCustomize={onOpenCustomize}
        />
      </div>
    </div>
  );
}
