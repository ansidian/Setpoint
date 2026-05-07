import { Inbox, LayoutList } from "lucide-react";
import { Kbd } from "./Kbd.jsx";

export function ShellTabs({ isMobile, tab, onTab, inboxUnreadSignalCount }) {
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
        const showUnread = tabKey === "inbox" && inboxUnreadSignalCount > 0;
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
              transition: "background 150ms, color 150ms",
              minWidth: 0,
            }}
          >
            {tabKey === "dashboard"
              ? <LayoutList size={isMobile ? 11 : 12} />
              : <Inbox size={isMobile ? 11 : 12} />}
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
                  color: "#89b4fa",
                  background: "rgba(137,180,250,0.14)",
                  border: "1px solid rgba(137,180,250,0.32)",
                  borderRadius: 99,
                  letterSpacing: 0,
                }}
              >
                {inboxUnreadSignalCount > 99 ? "99+" : inboxUnreadSignalCount}
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
