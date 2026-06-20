import { CalendarDays, Inbox, LayoutList, Notebook } from "lucide-react";
import { Kbd } from "./Kbd.jsx";

const TAB_ICONS = { dashboard: LayoutList, inbox: Inbox, calendar: CalendarDays, notes: Notebook };
const TAB_LABELS = { dashboard: "Dashboard", inbox: "Inbox", calendar: "Calendar", notes: "Notes" };
const TAB_KEYS = { dashboard: "1", inbox: "2", calendar: "3", notes: "4" };

export function ShellTabs({ isMobile, tab, onTab, inboxUnreadSignalCount }) {
  const tabs = isMobile ? ["dashboard", "inbox", "notes"] : ["dashboard", "inbox", "calendar", "notes"];
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
      {tabs.map((tabKey) => {
        const showUnread = tabKey === "inbox" && inboxUnreadSignalCount > 0;
        const Icon = TAB_ICONS[tabKey];
        return (
          <button
            key={tabKey}
            type="button"
            onClick={() => onTab(tabKey)}
            style={{
              padding: isMobile ? "9px 12px" : "5px 12px",
              minHeight: isMobile ? 44 : undefined,
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              fontSize: isMobile ? 11 : 11.5,
              fontWeight: 600,
              letterSpacing: 0.3,
              fontFamily: "inherit",
              background: tab === tabKey ? "rgba(255,255,255,0.06)" : "transparent",
              color: tab === tabKey ? "#cdd6f4" : "var(--color-text-faint)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              transition: "background 150ms, color 150ms",
              minWidth: 0,
              touchAction: "manipulation",
            }}
          >
            <Icon size={isMobile ? 11 : 12} />
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
            <span>{TAB_LABELS[tabKey]}</span>
            {!isMobile && <Kbd>{TAB_KEYS[tabKey]}</Kbd>}
          </button>
        );
      })}
    </div>
  );
}
