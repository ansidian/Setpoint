import { MessageSquare } from "lucide-react";
import "./ShellAlfredTrigger.css";
import "./ShellHeader.css";
import { publicAssetUrl } from "@/publicAsset";
import MobileShellActions from "./MobileShellActions";
import { memo, useEffect, useRef, useState } from "react";
import {
  OverflowMenu,
  PaletteTriggerButton,
  RefreshButton,
  ShellBrand,
  ShellTabs,
} from "./ShellHeaderChrome";
import { SystemStatusButton } from "./SystemStatusButton";
import { isDemoMode } from "../../demo/config";
import {
  resolveNotesNavigationChord,
  resolveShellTabHotkey,
} from "../dashboard/dashboardShellModel";
import type { DashboardTab } from "../dashboard/dashboardShellModel";
import type { SystemStatusView } from "./SystemStatusButton";

export interface ShellHeaderProps {
  isMobile?: boolean;
  onAskAlfred?: () => void;
  alfredOpen?: boolean;
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
 * Tabs retain their number shortcuts; ⌘K opens the palette.
 * Desktop health owns Sync now; mobile keeps its existing sync control.
 *
 * Wrapped in React.memo: its callback props are now referentially stable from
 * DashboardShell, so the header chrome no longer re-renders on every dashboard
 * data refetch.
 */
function ShellHeader({
  isMobile = false,
  onAskAlfred,
  alfredOpen = false,
  tab,
  onTab,
  anyBlockingOverlayOpen = false,
  onOpenAnalytics,
  onOpenPalette,
  onOpenHistory,
  inboxUnreadSignalCount = 0,
  refreshing,
  onQuickRefresh,
  systemStatus,
}: ShellHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const notesNavigationChordRef = useRef(false);
  const notesNavigationChordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoMode = isDemoMode();

  useEffect(() => {
    const clearNotesNavigationChord = () => {
      notesNavigationChordRef.current = false;
      if (notesNavigationChordTimerRef.current) {
        clearTimeout(notesNavigationChordTimerRef.current);
        notesNavigationChordTimerRef.current = null;
      }
    };

    function onNotesNavigationKey(event: KeyboardEvent) {
      const command = resolveNotesNavigationChord({
        key: event.key,
        code: event.code,
        leaderActive: notesNavigationChordRef.current,
        activeTab: tab,
        anyBlockingOverlayOpen,
        defaultPrevented: event.defaultPrevented,
        repeat: event.repeat,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      });

      if (command.action === "ignore") return;
      if (command.action === "cancel") {
        clearNotesNavigationChord();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (command.action === "start") {
        clearNotesNavigationChord();
        notesNavigationChordRef.current = true;
        notesNavigationChordTimerRef.current = setTimeout(clearNotesNavigationChord, 900);
        return;
      }

      clearNotesNavigationChord();
      onTab(command.tab);
    }

    // Capture before tldraw so the destination digit cannot also select a tool.
    window.addEventListener("keydown", onNotesNavigationKey, true);
    return () => {
      window.removeEventListener("keydown", onNotesNavigationKey, true);
      clearNotesNavigationChord();
    };
  }, [anyBlockingOverlayOpen, onTab, tab]);

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

  if (isMobile && tab === "dashboard") {
    const date = new Date();
    return (
      <header className="mobile-dashboard-header" data-testid="shell-header-mobile">
        <h1><img src={publicAssetUrl("favicon.svg")} alt="" width={22} height={22} />Dashboard</h1>
        <time dateTime={new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(date)}>
          {new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" }).format(date)}
        </time>
        <MobileShellActions refreshing={refreshing} onQuickRefresh={onQuickRefresh} systemStatus={systemStatus} onOpenHistory={onOpenHistory} onOpenAnalytics={onOpenAnalytics} />
      </header>
    );
  }

  return (
    <div
      data-testid={isMobile ? "shell-header-mobile" : "shell-header-desktop"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: isMobile ? "10px 12px" : "8px 20px",
        paddingTop: `calc(${isMobile ? "10px" : "8px"} + var(--sp-safe-top))`,
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
      {!isMobile && !demoMode && onAskAlfred && (
        <button type="button" className="shell-alfred-trigger" aria-label="Ask Alfred" onClick={onAskAlfred} aria-expanded={alfredOpen} title="Ask Alfred (⌘\)">
          <MessageSquare size={14} aria-hidden="true" />
          <span>Alfred</span>
        </button>
      )}
      {!isMobile && <PaletteTriggerButton onOpenPalette={onOpenPalette} />}
      {isMobile && <RefreshButton
        isMobile={isMobile}
        refreshing={refreshing}
        onQuickRefresh={onQuickRefresh}
      />}
      <SystemStatusButton isMobile={isMobile} systemStatus={systemStatus} refreshing={!isMobile && refreshing} onQuickRefresh={isMobile ? undefined : onQuickRefresh} />
      <div style={{ position: "relative" }}>
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
