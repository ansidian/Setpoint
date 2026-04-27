import { useEffect, useRef, useState } from "react";
import {
  BriefingStatusPill,
  ConfirmGenerateToast,
  OverflowMenu,
  PaletteTriggerButton,
  RefreshButton,
  ShellBrand,
  ShellTabs,
} from "./ShellHeaderChrome";

/**
 * ShellHeader — top chrome for the dashboard/inbox shell.
 * Tabs are hotkey-indexed (1 = dashboard, 2 = inbox). ⌘K opens the palette.
 * Refresh shows a progress fill while holding, becomes a confirm pill at 100%.
 */
export default function ShellHeader({
  accent,
  isMobile = false,
  tab,
  onTab,
  onOpenPalette,
  onOpenCustomize,
  onOpenHistory,
  onOpenCalendar,
  briefingStatus,
  liveUnreadCount = 0,
  refreshHold,
  refreshing,
  generating,
  onQuickRefresh,
  onFullGenerate,
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

  const holdPct = refreshHold?.holdProgress ?? 0;
  const confirming = refreshHold?.showConfirm;

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
        liveUnreadCount={liveUnreadCount}
      />
      <div style={{ flex: 1 }} />
      {!isMobile && <PaletteTriggerButton onOpenPalette={onOpenPalette} />}
      {!isMobile && (
        <BriefingStatusPill accent={accent} briefingStatus={briefingStatus} />
      )}
      <RefreshButton
        accent={accent}
        isMobile={isMobile}
        refreshHold={refreshHold}
        refreshing={refreshing}
        generating={generating}
        holdPct={holdPct}
        onQuickRefresh={onQuickRefresh}
      />
      <div ref={menuRef} style={{ position: "relative" }}>
        <OverflowMenu
          isMobile={isMobile}
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen((value) => !value)}
          onCloseMenu={() => setMenuOpen(false)}
          onOpenHistory={onOpenHistory}
          onOpenCalendar={onOpenCalendar}
          onOpenCustomize={onOpenCustomize}
        />
      </div>
      <ConfirmGenerateToast
        accent={accent}
        confirming={confirming}
        onFullGenerate={onFullGenerate}
        onCancel={() => refreshHold?.setShowConfirm?.(false)}
      />
    </div>
  );
}
