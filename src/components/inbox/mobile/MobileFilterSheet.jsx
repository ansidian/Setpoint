import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function MobileFilterSheet({
  open,
  accent,
  triggerRef,
  panelRef,
  accountId,
  setAccountId,
  accounts,
  totalUnread,
  onClose,
}) {
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (panelRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
      onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose, panelRef, triggerRef]);

  useEffect(() => {
    if (!open) return undefined;
    const element = panelRef.current;
    if (!element) return undefined;
    function onWheel(event) {
      const atTop = element.scrollTop <= 0;
      const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
      if ((atTop && event.deltaY < 0) || (atBottom && event.deltaY > 0)) event.preventDefault();
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [open, panelRef]);

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "rgba(0,0,0,0.48)",
      }}
    >
      <div
        ref={panelRef}
        data-testid="inbox-mobile-filter-sheet"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "72vh",
          padding: "16px 16px 24px",
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          background: "var(--sp-panel)",
          borderTop: `1px solid ${accent}30`,
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          isolation: "isolate",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div
            style={{
              width: 42,
              height: 4,
              borderRadius: 999,
              background: "rgba(255,255,255,0.16)",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: accent,
            }}
          >
            Accounts
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--color-text-faint)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              padding: "0 12px",
            }}
          >
            Done
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              setAccountId("__all");
              onClose();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              background: accountId === "__all" ? `${accent}14` : "rgba(255,255,255,0.03)",
              border: `1px solid ${accountId === "__all" ? `${accent}40` : "rgba(255,255,255,0.08)"}`,
              color: "#fff",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>All accounts</div>
              <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 2 }}>
                {totalUnread} unread across inbox
              </div>
            </div>
          </button>
          {accounts.map((account) => {
            const accountKey = account.id || account.name;
            const active = accountId === accountKey;
            return (
              <button
                key={accountKey}
                type="button"
                onClick={() => {
                  setAccountId(accountKey);
                  onClose();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: active ? `${account.color || accent}14` : "rgba(255,255,255,0.03)",
                  border: `1px solid ${active ? `${account.color || accent}40` : "rgba(255,255,255,0.08)"}`,
                  color: "#fff",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: account.color || accent,
                    boxShadow: `0 0 8px ${(account.color || accent)}66`,
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {account.name || account.email}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-faint)",
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {account.email}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: account.color || accent,
                    background: `${account.color || accent}18`,
                    borderRadius: 999,
                    padding: "2px 7px",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {account.unread || 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
