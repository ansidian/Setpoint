import {
  CheckCheck,
  Filter,
  Search,
  Sparkles,
} from "lucide-react";
import EmailRow from "../EmailRow";
import Reader from "../reader/Reader";
import MobileFilterSheet from "./MobileFilterSheet";
import { Skeleton } from "@/components/ui/skeleton";

const MOBILE_FILTER_CHIPS = [
  { key: "__all", label: "All" },
  { key: "__live", label: "New" },
  { key: "action", label: "Action" },
  { key: "fyi", label: "FYI" },
  { key: "noise", label: "Noise" },
];

function MobileChip({ active, label, count, onClick, accent }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: "100%",
        minWidth: 0,
        padding: "8px 6px",
        borderRadius: 999,
        border: `1px solid ${active ? `${accent}48` : "rgba(255,255,255,0.08)"}`,
        background: active ? `${accent}16` : "rgba(255,255,255,0.03)",
        color: active ? "#fff" : "rgba(205,214,244,0.72)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 10.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <span
        style={{
          minWidth: 16,
          height: 16,
          padding: "0 4px",
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: active ? `${accent}28` : "rgba(255,255,255,0.06)",
          color: active ? accent : "rgba(205,214,244,0.5)",
          fontSize: 8.5,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}
      >
        {count}
      </span>
    </button>
  );
}

function MobileIconButton({ icon, label, onClick, accent, buttonRef, tinted = false, testId }) {
  const Icon = icon;
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
      style={{
        width: 34,
        height: 34,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        border: `1px solid ${tinted ? `${accent}40` : "rgba(255,255,255,0.08)"}`,
        background: tinted ? `${accent}16` : "rgba(255,255,255,0.03)",
        color: tinted ? accent : "rgba(205,214,244,0.7)",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <Icon size={15} />
    </button>
  );
}

function MobileLiveSkeletonRows({ count = 4, compact = false }) {
  return (
    <div data-testid="inbox-mobile-live-skeleton" style={{ padding: compact ? "6px 0 2px" : "8px 16px 24px" }}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          style={{
            padding: compact ? "10px 0" : "14px 0",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Skeleton style={{ width: 30, height: 30, borderRadius: 999, background: "rgba(205,214,244,0.10)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton style={{ width: index % 2 ? "62%" : "74%", height: 10, background: "rgba(205,214,244,0.11)" }} />
              <Skeleton style={{ width: index % 2 ? "76%" : "58%", height: 8, marginTop: 8, background: "rgba(205,214,244,0.07)" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MobileLiveLoadingBlock({ compact = false }) {
  return (
    <div
      data-testid="inbox-mobile-live-loading-block"
      style={{
        margin: "8px 16px 2px",
        padding: compact ? "10px 12px 8px" : "10px 12px 12px",
        borderRadius: 10,
        border: "1px solid rgba(137,180,250,0.18)",
        background: "rgba(137,180,250,0.06)",
        color: "rgba(205,214,244,0.72)",
        fontSize: 11,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Skeleton style={{ width: 8, height: 8, borderRadius: 999, background: "rgba(137,180,250,0.75)" }} />
        Checking live mail
      </div>
      <MobileLiveSkeletonRows count={compact ? 2 : 3} compact />
    </div>
  );
}

export default function MobileInboxView({
  accent,
  briefingSummary,
  emailAccounts,
  accountId,
  setAccountId,
  lane,
  setLane,
  search,
  setSearch,
  searchRef,
  mobileFilterTriggerRef,
  mobileFilterPanelRef,
  selectedEmail,
  selectedAccount,
  setSelectedId,
  closeSelectedEmail,
  mobileFiltersOpen,
  setMobileFiltersOpen,
  pinnedSet,
  billOpen,
  setBillOpen,
  accountsById,
  visibleEmails,
  mobileChipCounts,
  totalUnread,
  unreadInView,
  markAllVisibleRead,
  onAction,
  trashHold,
  snoozeHold,
  showTriage,
  showDraft,
  showPreview,
  density,
  briefingAgoLabel,
  scopedAccount,
  liveEmailsLoading = false,
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "transparent",
        color: "#cdd6f4",
      }}
    >
      {selectedEmail ? (
        <Reader
          key={selectedEmail?.id || selectedEmail?.uid || "empty"}
          email={selectedEmail}
          account={selectedAccount}
          accent={accent}
          pinned={!!selectedEmail && (pinnedSet.has(selectedEmail.uid) || pinnedSet.has(selectedEmail.id))}
          onAction={onAction}
          onClose={closeSelectedEmail}
          showTriage={showTriage}
          showDraft={showDraft}
          billOpen={billOpen}
          setBillOpen={setBillOpen}
          trashHoldProgress={trashHold.progress}
          snoozeHoldProgress={snoozeHold.progress}
          isMobile
        />
      ) : (
        <div
          data-testid="inbox-mobile-list"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}
        >
          <div style={{ padding: "16px 16px 0" }}>
            <div
              style={{
                padding: "14px 14px 12px",
                borderRadius: 14,
                background: `linear-gradient(135deg, ${accent}12, rgba(137,220,235,0.04))`,
                border: `1px solid ${accent}2c`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={13} color={accent} />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1.8,
                    textTransform: "uppercase",
                    color: accent,
                  }}
                >
                  Inbox snapshot
                </span>
                <span style={{ flex: 1 }} />
                {briefingAgoLabel && (
                  <span style={{ fontSize: 10, color: "rgba(205,214,244,0.5)" }}>
                    {briefingAgoLabel}
                  </span>
                )}
              </div>
              {briefingSummary && (
                <div
                  className="ea-display"
                  style={{
                    marginTop: 8,
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: "rgba(255,255,255,0.92)",
                    fontStyle: "italic",
                  }}
                >
                  {briefingSummary}
                </div>
              )}
              <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 11, color: "rgba(205,214,244,0.62)" }}>
                  <span style={{ color: "#fff", fontWeight: 700 }}>{unreadInView}</span> unread
                </div>
                <div style={{ fontSize: 11, color: "rgba(205,214,244,0.62)" }}>
                  <span style={{ color: "#fff", fontWeight: 700 }}>{mobileChipCounts.__live}</span> new
                </div>
                <div style={{ fontSize: 11, color: "rgba(205,214,244,0.62)" }}>
                  <span style={{ color: "#fff", fontWeight: 700 }}>{mobileChipCounts.__all}</span> in scope
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 4,
              padding: "12px 16px 10px",
              marginTop: 14,
              background: "linear-gradient(180deg, rgba(11,11,19,0.98), rgba(11,11,19,0.94))",
              backdropFilter: "blur(14px)",
              borderTop: "1px solid rgba(255,255,255,0.04)",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "0 10px",
                  height: 36,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Search size={13} color="rgba(205,214,244,0.45)" />
                <input
                  ref={searchRef}
                  aria-label="Search inbox"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search inbox"
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "#cdd6f4",
                    fontSize: 12,
                    fontFamily: "inherit",
                  }}
                />
              </div>
              <MobileIconButton
                icon={Filter}
                label="Open filters"
                onClick={() => setMobileFiltersOpen(true)}
                accent={accent}
                buttonRef={mobileFilterTriggerRef}
                testId="inbox-mobile-filter-trigger"
              />
              <MobileIconButton
                icon={CheckCheck}
                label="Mark all read"
                onClick={markAllVisibleRead}
                accent={accent}
                tinted={unreadInView > 0}
              />
            </div>

            <div
              data-testid="inbox-mobile-chip-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: 6,
                paddingTop: 10,
              }}
            >
              {MOBILE_FILTER_CHIPS.map((chip) => (
                <MobileChip
                  key={chip.key}
                  active={lane === chip.key}
                  label={chip.label}
                  count={mobileChipCounts[chip.key]}
                  onClick={() => setLane(chip.key)}
                  accent={accent}
                />
              ))}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingTop: 10,
                fontSize: 11,
                color: "rgba(205,214,244,0.5)",
              }}
            >
              <span>{scopedAccount ? scopedAccount.name || scopedAccount.email : "All accounts"}</span>
              <span style={{ opacity: 0.35 }}>·</span>
              <span>{visibleEmails.length} shown</span>
            </div>
          </div>

          <div style={{ padding: "6px 0 20px" }}>
            {liveEmailsLoading && visibleEmails.length > 0 && <MobileLiveLoadingBlock compact />}
            {liveEmailsLoading && visibleEmails.length === 0 ? (
              <MobileLiveLoadingBlock />
            ) : visibleEmails.length > 0 ? (
              visibleEmails.map((email) => (
                <EmailRow
                  key={email.id || email.uid}
                  email={email}
                  account={accountsById[email.accountId] || accountsById[email._accountKey]}
                  selected={false}
                  onOpen={(opened) => setSelectedId(opened.id || opened.uid)}
                  density={density}
                  showPreview={showPreview}
                  accent={accent}
                  pinned={!!(pinnedSet.has(email.uid) || pinnedSet.has(email.id))}
                />
              ))
            ) : (
              <div
                style={{
                  padding: "36px 18px",
                  textAlign: "center",
                  color: "rgba(205,214,244,0.45)",
                  fontSize: 12,
                }}
              >
                No emails match this view.
              </div>
            )}
          </div>
        </div>
      )}

      <MobileFilterSheet
        open={mobileFiltersOpen}
        accent={accent}
        triggerRef={mobileFilterTriggerRef}
        panelRef={mobileFilterPanelRef}
        accountId={accountId}
        setAccountId={setAccountId}
        accounts={emailAccounts}
        totalUnread={totalUnread}
        onClose={() => setMobileFiltersOpen(false)}
      />
    </div>
  );
}
