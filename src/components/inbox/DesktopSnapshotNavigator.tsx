import { LoaderCircle } from "lucide-react";
import { formatSnapshotContext } from "./snapshotSummary";
import SnapshotNavigationControls from "./SnapshotNavigationControls";
import type { InboxSnapshotNavigation } from "./inboxViewTypes";

export default function DesktopSnapshotNavigator({
  navigation,
  liveLoading,
  processingCount,
  readOnly,
}: {
  navigation: InboxSnapshotNavigation | null;
  liveLoading: boolean;
  processingCount: number;
  readOnly: boolean;
}) {
  const rawContext = formatSnapshotContext(navigation?.snapshot || null);
  const context = navigation?.snapshot && !navigation.snapshot.schedule_label
    ? rawContext
      ?.replace(" · Current · ", " · ")
      .replace(" · Snapshot · ", " · ") || null
    : rawContext;
  const updating = !readOnly && (liveLoading || processingCount > 0);

  if (!navigation && !updating) return null;

  return (
    <div
      data-testid="desktop-snapshot-navigator"
      style={{
        minHeight: 42,
        padding: "6px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexShrink: 0,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: "color-mix(in srgb, var(--ea-accent) 2%, transparent)",
      }}
    >
      {navigation ? (
        <div style={{ flex: 1, minWidth: 0 }}>
          <SnapshotNavigationControls
            navigation={navigation}
            historical={readOnly}
            onNavigate={(direction) => { void navigation.onNavigate(direction); }}
            context={context ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  minWidth: 0,
                  color: "rgba(205,214,244,0.72)",
                  fontSize: 10.5,
                  fontWeight: 500,
                  lineHeight: 1.35,
                  whiteSpace: "nowrap",
                }}
              >
                <span>{context}</span>
                {readOnly && (
                  <span
                    style={{
                      padding: "2px 5px",
                      borderRadius: 5,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.025)",
                      color: "var(--color-text-faint)",
                      fontSize: 9,
                      fontWeight: 650,
                    }}
                  >
                    Read only
                  </span>
                )}
              </div>
            ) : null}
          />
        </div>
      ) : <span />}

      {updating && (
        <div
          role="status"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            color: "var(--sp-blue)",
            fontSize: 10,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" />
          {processingCount > 0 ? `Updating ${processingCount}` : "Updating"}
        </div>
      )}
    </div>
  );
}
