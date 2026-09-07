import { useEffect } from "react";
import { getInboxSession } from "../inbox/useInboxSessionState";
import { resolveDashboardShellHotkey } from "./dashboardShellModel";
import type { Dispatch, SetStateAction } from "react";
import type { DashboardTab } from "./dashboardShellModel";

interface DashboardShellHotkeysOptions {
  isMobile: boolean;
  analyticsOpen: boolean;
  historyOpen?: boolean;
  anyBlockingOverlayOpen?: boolean;
  openPalette: () => void;
  openAnalytics: () => void | Promise<unknown>;
  closeAnalytics: () => void;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  toggleAlfred: () => void;
  alfredNewChat: () => void;
  activeTab: DashboardTab;
}

// Global shell hotkeys: ⌘K palette, A analytics, Y snapshots, and Alfred.
// The shell yields single-key actions to open panels and selected email triage.
export default function useDashboardShellHotkeys({
  isMobile,
  analyticsOpen,
  historyOpen = false,
  anyBlockingOverlayOpen = false,
  openPalette,
  openAnalytics,
  closeAnalytics,
  setHistoryOpen,
  toggleAlfred,
  alfredNewChat,
  activeTab,
}: DashboardShellHotkeysOptions) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing || document.querySelector("[data-workspace-foreground]")) return;
      const target = e.target as HTMLElement;
      const editableTarget = !!(
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.tagName === "SELECT"
        || target.isContentEditable
        || target.closest?.("[data-suspend-calendar-hotkeys='true'], [data-suspend-calendar-hotkeys='all'], [data-suspend-inbox-hotkeys='true']")
      );
      const command = resolveDashboardShellHotkey({
        key: e.key,
        code: e.code,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        defaultPrevented: e.defaultPrevented,
        repeat: e.repeat,
        editableTarget,
        emailSelected: getInboxSession().selectedId != null,
        anyBlockingOverlayOpen: anyBlockingOverlayOpen
          || Array.from(document.querySelectorAll("[role='dialog'], [role='menu'], [role='listbox']"))
            .some((overlay) => overlay.getClientRects().length > 0),
        analyticsOpen,
        historyOpen,
        isMobile,
        activeTab,
      });

      if (command.action === "open-palette") {
        e.preventDefault();
        openPalette();
        return;
      }
      if (command.action === "toggle-alfred") {
        e.preventDefault();
        toggleAlfred();
        return;
      }
      if (command.action === "alfred-new-chat") {
        e.preventDefault();
        alfredNewChat();
        return;
      }
      if (command.action === "toggle-analytics") {
        e.preventDefault();
        if (analyticsOpen) closeAnalytics();
        else void openAnalytics();
        return;
      }
      if (command.action === "toggle-history") { setHistoryOpen((v) => !v); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab, analyticsOpen, historyOpen, anyBlockingOverlayOpen, closeAnalytics, isMobile, openAnalytics, openPalette, setHistoryOpen, toggleAlfred, alfredNewChat]);
}
