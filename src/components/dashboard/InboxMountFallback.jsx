const ROWS = [0, 1, 2, 3, 4, 5];

// Lives in the shell chunk (statically imported by DashboardShell) so it can paint
// the instant the inbox tab is tapped, while the lazy InboxView chunk loads. It
// approximates the mobile inbox header + rows so the swap into the real list is
// dimensionally calm rather than a blank flash. Decorative only: aria-hidden.
export default function InboxMountFallback() {
  return (
    <div
      data-testid="inbox-mount-fallback"
      aria-hidden="true"
      style={{
        height: "100%",
        padding: "16px 16px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <style>{`
        @keyframes eaInboxFallbackPulse { 0%, 100% { opacity: 0.5 } 50% { opacity: 0.9 } }
        @media (prefers-reduced-motion: reduce) {
          .ea-inbox-fallback-bar { animation: none !important; opacity: 0.6 !important }
        }
      `}</style>

      <div
        className="ea-inbox-fallback-bar"
        style={{
          height: 78,
          borderRadius: 14,
          background: "rgba(205,214,244,0.05)",
          border: "1px solid rgba(255,255,255,0.05)",
          animation: "eaInboxFallbackPulse 1.4s ease-in-out infinite",
        }}
      />

      <div style={{ display: "flex", gap: 8 }}>
        <div
          className="ea-inbox-fallback-bar"
          style={{
            flex: 1,
            height: 40,
            borderRadius: 10,
            background: "rgba(205,214,244,0.05)",
            animation: "eaInboxFallbackPulse 1.4s ease-in-out infinite",
          }}
        />
        {[0, 1].map((i) => (
          <div
            key={i}
            className="ea-inbox-fallback-bar"
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "rgba(205,214,244,0.05)",
              animation: "eaInboxFallbackPulse 1.4s ease-in-out infinite",
            }}
          />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
        {ROWS.map((i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              padding: "14px 0",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <div
              className="ea-inbox-fallback-bar"
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                background: "rgba(205,214,244,0.08)",
                animation: "eaInboxFallbackPulse 1.4s ease-in-out infinite",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="ea-inbox-fallback-bar"
                style={{
                  width: i % 2 ? "62%" : "74%",
                  height: 10,
                  borderRadius: 4,
                  background: "rgba(205,214,244,0.09)",
                  animation: "eaInboxFallbackPulse 1.4s ease-in-out infinite",
                }}
              />
              <div
                className="ea-inbox-fallback-bar"
                style={{
                  width: i % 2 ? "76%" : "58%",
                  height: 8,
                  marginTop: 8,
                  borderRadius: 4,
                  background: "rgba(205,214,244,0.06)",
                  animation: "eaInboxFallbackPulse 1.4s ease-in-out infinite",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
