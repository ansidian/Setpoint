import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { DashboardTab } from "../dashboard/dashboardShellModel";

// Exported so DashboardShell's tabpanel wrappers can reuse the same label
// text for their mobile aria-label fallback (ShellTabs doesn't render on
// mobile, so the ids these labels would otherwise resolve via aria-labelledby
// don't exist there).
// eslint-disable-next-line react-refresh/only-export-components
export const TAB_LABELS: Record<DashboardTab, string> = {
  dashboard: "Dashboard", inbox: "Inbox", calendar: "Calendar", notes: "Notes", news: "News",
};
const TAB_KEYS = { dashboard: "1", inbox: "2", calendar: "3", notes: "4", news: "5" };
const TABS = ["dashboard", "inbox", "calendar", "notes", "news"] as const satisfies readonly DashboardTab[];

// WAI-ARIA tabs pattern (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/):
// activation-follows-focus roving tabindex. There are only 5 cheap, always-
// mounted (KeepAliveTab) panels, so moving focus with the arrow keys also
// switches the tab immediately instead of requiring a separate activation key.
export function ShellTabs({ tab, onTab, inboxUnreadSignalCount, notesEnabled = true }: {
  tab: DashboardTab;
  onTab: (tab: DashboardTab) => void;
  inboxUnreadSignalCount: number;
  notesEnabled?: boolean;
}) {
  const tabs: readonly DashboardTab[] = notesEnabled ? TABS : TABS.filter((candidate) => candidate !== "notes");
  const tabRefs = useRef<Partial<Record<DashboardTab, HTMLButtonElement | null>>>({});

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const currentIndex = tabs.indexOf(tab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    onTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Primary"
      className="shell-primary-tabs"
    >
      {tabs.map((tabKey) => {
        const showUnread = tabKey === "inbox" && inboxUnreadSignalCount > 0;
        return (
          <button
            key={tabKey}
            ref={(el) => { tabRefs.current[tabKey] = el; }}
            type="button"
            role="tab"
            id={`shell-tab-${tabKey}`}
            aria-controls={`shell-tabpanel-${tabKey}`}
            aria-selected={tab === tabKey}
            tabIndex={tab === tabKey ? 0 : -1}
            className="shell-nav-tab"
            title={`${TAB_LABELS[tabKey]} (${tab === "notes" ? "`" : ""}${TAB_KEYS[tabKey]})`}
            onClick={() => onTab(tabKey)}
            onKeyDown={handleKeyDown}
          >
            <span>{TAB_LABELS[tabKey]}</span>
            {showUnread && (
              <span
                title={`${inboxUnreadSignalCount} unread`}
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
                  color: "var(--sp-rose)",
                  background: "color-mix(in srgb, var(--sp-rose) 18%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--sp-rose) 32%, transparent)",
                  borderRadius: 99,
                  letterSpacing: 0,
                }}
              >
                {inboxUnreadSignalCount > 99 ? "99+" : inboxUnreadSignalCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
