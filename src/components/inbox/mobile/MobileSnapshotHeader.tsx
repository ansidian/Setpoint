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
            {activeSnapshotMode ? readOnly ? "Snapshot" : "Active snapshot" : "Inbox snapshot"}
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
        {activeSnapshotMode && readOnly && (
          <div
            style={{
              marginTop: 5,
              fontSize: 10.5,
              lineHeight: 1.4,
              color: "var(--color-text-faint)",
            }}
          >
            {formatSnapshotContext(snapshotNavigation?.snapshot || null) || "Historical email window"}
          </div>
        )}
        {activeSnapshotMode && snapshotNavigation && (
          <div
            style={{
              marginTop: 9,
              paddingTop: 9,
              borderTop: "1px solid rgba(255,255,255,0.055)",
            }}
          >
            <SnapshotNavigationControls
              navigation={snapshotNavigation}
              historical={readOnly}
              mobile
              onNavigate={(direction) => { void snapshotNavigation.onNavigate(direction); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
