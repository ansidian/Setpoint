import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import SnapshotNavigationControls from "../SnapshotNavigationControls";
import { formatSnapshotContext } from "../snapshotSummary";
import type { InboxSnapshotNavigation } from "../inboxViewTypes";

export default function MobileSnapshotHeader({
  accent,
  activeSnapshotMode,
  readOnly,
  summary,
  noiseUnreadCount,
  snapshotNavigation,
}: {
  accent: string;
  activeSnapshotMode: boolean;
  readOnly: boolean;
  summary: ReactNode;
  noiseUnreadCount: number;
  snapshotNavigation: InboxSnapshotNavigation | null;
}) {
  const rawContext = formatSnapshotContext(snapshotNavigation?.snapshot || null);
  const snapshotContext = snapshotNavigation?.snapshot && !snapshotNavigation.snapshot.schedule_label
    ? rawContext
      ?.replace(" · Current · ", " · ")
      .replace(" · Snapshot · ", " · ") || null
    : rawContext;

  if (activeSnapshotMode) {
    return (
      <div
        data-testid="mobile-snapshot-pager"
        style={{
          padding: "6px 16px 0",
          background: "linear-gradient(180deg, color-mix(in srgb, var(--sp-deep) 99%, transparent), color-mix(in srgb, var(--sp-deep) 97%, transparent))",
        }}
      >
        {snapshotNavigation ? (
          <SnapshotNavigationControls
            navigation={snapshotNavigation}
            historical={readOnly}
            mobile
            context={(
              <div
                style={{
                  width: "100%",
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  lineHeight: 1.25,
                  textAlign: "center",
                }}
              >
                <span
                  style={{
                    width: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "rgba(205,214,244,0.82)",
                    fontSize: 10.5,
                    fontWeight: 600,
                  }}
                >
                  {snapshotContext || (readOnly ? "Historical snapshot" : "Current snapshot")}
                </span>
                {(readOnly || snapshotContext) && (
                  <span
                    style={{
                      color: readOnly ? "var(--color-text-faint)" : accent,
                      fontSize: 9,
                      fontWeight: 650,
                    }}
                  >
                    {readOnly ? "Read only" : "Current"}
                  </span>
                )}
              </div>
            )}
            onNavigate={(direction) => { void snapshotNavigation.onNavigate(direction); }}
          />
        ) : (
          <div
            style={{
              minHeight: "var(--sp-touch-min)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: accent,
              fontSize: 10.5,
              fontWeight: 650,
            }}
          >
            Current snapshot
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: "10px 16px 0" }}>
      <div
        style={{
          padding: "10px 12px",
          borderRadius: 12,
          background: `linear-gradient(135deg, ${accent}12, color-mix(in srgb, var(--sp-cyan) 4%, transparent))`,
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
          {noiseUnreadCount > 0 && (
            <span style={{ fontSize: 10.5, color: "var(--color-text-faint)", whiteSpace: "nowrap" }}>
              <span style={{ color: "rgba(205,214,244,0.78)", fontWeight: 700 }}>{noiseUnreadCount}</span> noise unread
            </span>
          )}
        </div>
        {summary && (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              lineHeight: 1.4,
              color: "rgba(205,214,244,0.82)",
            }}
          >
            {summary}
          </div>
        )}
      </div>
    </div>
  );
}
