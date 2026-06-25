import { Inbox, LayoutList, Notebook } from "lucide-react";

const NAV_TABS = ["dashboard", "inbox", "notes"];
const NAV_ICONS = { dashboard: LayoutList, inbox: Inbox, notes: Notebook };
const NAV_LABELS = { dashboard: "Dashboard", inbox: "Inbox", notes: "Notes" };

// Mobile-only bottom tab bar. Rendered as the last in-flow flex child of
// DashboardShell's fixed inset-0 column, so it pins to the viewport bottom and
// the flex:1 tab body shrinks to reserve its height. No position:fixed / z-index:
// body-portal sheets (z-50) and AlfredPanel (z-60) paint above the whole column.
export function MobileBottomNav({ tab, onTab, inboxUnreadSignalCount }) {
  return (
    <nav
      aria-label="Primary"
      data-testid="mobile-bottom-nav"
      style={{
        flexShrink: 0,
        display: "flex",
        background: "var(--sp-header-chrome)",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        paddingBottom: "var(--sp-safe-bottom)",
      }}
    >
      {NAV_TABS.map((tabKey) => {
        const active = tab === tabKey;
        const showUnread = tabKey === "inbox" && inboxUnreadSignalCount > 0;
        const Icon = NAV_ICONS[tabKey];
        return (
          <button
            key={tabKey}
            type="button"
            aria-label={NAV_LABELS[tabKey]}
            aria-current={active ? "page" : undefined}
            onClick={() => onTab(tabKey)}
            style={{
              flex: 1,
              minHeight: "var(--sp-touch-min)",
              border: "none",
              cursor: "pointer",
              background: "transparent",
              color: active ? "var(--sp-accent)" : "var(--color-text-faint)",
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              padding: "6px 4px",
              fontFamily: "inherit",
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: 0.2,
              transition: "color 150ms",
            }}
          >
            <span style={{ position: "relative", display: "inline-flex" }}>
              <Icon size={20} />
              {showUnread && (
                <span
                  title={`${inboxUnreadSignalCount} unread`}
                  style={{
                    position: "absolute",
                    top: -5,
                    left: "100%",
                    transform: "translateX(-45%)",
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
            </span>
            <span>{NAV_LABELS[tabKey]}</span>
          </button>
        );
      })}
    </nav>
  );
}
