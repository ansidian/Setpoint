import BottomSheet from "@/components/ui/BottomSheet";

const accountButtonStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
};

export default function MobileFilterSheet({
  open,
  accent,
  accountId,
  setAccountId,
  accounts,
  totalUnread,
  onClose,
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Accounts">
      <div
        data-testid="inbox-mobile-filter-sheet"
        style={{ padding: "8px 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}
      >
        <button
          type="button"
          onClick={() => { setAccountId("__all"); onClose(); }}
          style={{
            ...accountButtonStyle,
            background: accountId === "__all" ? `${accent}14` : "rgba(255,255,255,0.03)",
            border: `1px solid ${accountId === "__all" ? `${accent}40` : "rgba(255,255,255,0.08)"}`,
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
              onClick={() => { setAccountId(accountKey); onClose(); }}
              style={{
                ...accountButtonStyle,
                background: active ? `${account.color || accent}14` : "rgba(255,255,255,0.03)",
                border: `1px solid ${active ? `${account.color || accent}40` : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <span
                style={{
                  width: 10, height: 10, borderRadius: 999,
                  background: account.color || accent,
                  boxShadow: `0 0 8px ${(account.color || accent)}66`,
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {account.name || account.email}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {account.email}
                </div>
              </div>
              <span
                style={{
                  fontSize: 10, fontWeight: 700,
                  color: account.color || accent,
                  background: `${account.color || accent}18`,
                  borderRadius: 999, padding: "2px 7px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {account.unread || 0}
              </span>
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
