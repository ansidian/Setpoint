/* eslint-disable react-refresh/only-export-components */

function StatRow({ value, label }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "6px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span style={{ fontSize: 11, color: "var(--color-text-faint)" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: "#fff",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -0.2,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function renderEventsFooter({ computed }) {
  const totalEvents = computed?.totalEvents || 0;
  const allDayEvents = computed?.allDayEvents || 0;
  const activeDays = Object.keys(computed?.itemsByDay || {}).length;

  return (
    <div
      style={{
        padding: "10px 12px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <StatRow value={totalEvents} label="Events this month" />
      <StatRow value={activeDays} label="Active days" />
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          paddingTop: 6,
        }}
      >
        <span style={{ fontSize: 11, color: "var(--color-text-faint)" }}>
          All-day
        </span>
        <span
          style={{
            fontSize: 12,
            color: "rgba(205,214,244,0.8)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {allDayEvents}
        </span>
      </div>
    </div>
  );
}
