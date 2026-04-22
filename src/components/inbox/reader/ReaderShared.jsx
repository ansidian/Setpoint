import { ChevronDown, ChevronUp, Mail } from "lucide-react";
import { Kbd } from "../primitives";
import EmptyStateSplash from "../../shared/EmptyStateSplash";

export function MobileSection({ title, accent, open, onToggle, children, testId }) {
  return (
    <div
      data-testid={testId}
      style={{
        margin: "14px 16px 0",
        borderRadius: 12,
        background: "rgba(24,24,37,0.72)",
        border: `1px solid ${accent}22`,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 14px",
          border: "none",
          background: "transparent",
          color: "#fff",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            color: accent,
          }}
        >
          {title}
        </span>
        <span style={{ flex: 1 }} />
        {open ? (
          <ChevronUp size={16} color="rgba(205,214,244,0.6)" />
        ) : (
          <ChevronDown size={16} color="rgba(205,214,244,0.6)" />
        )}
      </button>
      {open && <div style={{ padding: "0 0 14px" }}>{children}</div>}
    </div>
  );
}

export function ReaderEmptyState() {
  return (
    <div
      style={{
        flex: 1,
        background: "rgba(22,22,30,0.5)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
      }}
    >
      <EmptyStateSplash
        icon={<Mail size={34} strokeWidth={1.8} />}
        eyebrow="Inbox reader"
        title="Select an email"
        message={(
          <>
            Open a thread to keep context visible while you work.
            <span
              style={{
                display: "block",
                marginTop: 12,
                fontSize: 11,
                color: "rgba(205,214,244,0.44)",
              }}
            >
              <Kbd>J</Kbd> <Kbd>K</Kbd> to move through the list.
            </span>
          </>
        )}
        compact
        minHeight={320}
      />
    </div>
  );
}
