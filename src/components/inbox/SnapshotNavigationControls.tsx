import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import type {
  InboxSnapshotNavigation,
  InboxSnapshotNavigationDirection,
} from "./inboxViewTypes";

interface SnapshotNavigationControlsProps {
  navigation: InboxSnapshotNavigation;
  historical: boolean;
  mobile?: boolean;
  context?: ReactNode;
  onNavigate: (direction: InboxSnapshotNavigationDirection) => void;
}

function SnapshotNavigationButton({
  direction,
  label,
  navigation,
  mobile,
  iconOnly,
  stretch,
  onNavigate,
}: {
  direction: InboxSnapshotNavigationDirection;
  label: string;
  navigation: InboxSnapshotNavigation;
  mobile: boolean;
  iconOnly: boolean;
  stretch: boolean;
  onNavigate: SnapshotNavigationControlsProps["onNavigate"];
}) {
  const available = direction === "older" ? navigation.canOlder : navigation.canNewer;
  const disabled = !available || navigation.historyLoading || !!navigation.navigating;
  const loading = navigation.navigating === direction
    || (navigation.historyLoading && direction === "older");
  const Icon = direction === "older" ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      aria-label={direction === "newer" && label === "Current"
        ? "Show current snapshot"
        : `Show ${direction} snapshot`}
      disabled={disabled}
      onClick={() => onNavigate(direction)}
      className="transition-[transform,background-color,border-color,color] duration-150 enabled:hover:-translate-y-px enabled:hover:border-white/15 enabled:hover:bg-white/[0.055] enabled:hover:text-white enabled:focus-visible:-translate-y-px active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ea-accent)]/60 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transform-none motion-reduce:transition-none"
      style={{
        minHeight: mobile ? "var(--sp-touch-min)" : 30,
        width: iconOnly ? "var(--sp-touch-min)" : undefined,
        padding: iconOnly ? 0 : mobile ? "0 12px" : "0 10px",
        borderRadius: iconOnly ? 10 : 8,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.025)",
        color: "rgba(205,214,244,0.76)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        flex: stretch ? 1 : "0 1 auto",
        fontFamily: "inherit",
        fontSize: mobile ? 10.5 : 10,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {direction === "older" && (
        loading
          ? <LoaderCircle size={iconOnly ? 16 : 13} className="animate-spin motion-reduce:animate-none" />
          : <Icon size={iconOnly ? 16 : 13} />
      )}
      <span className={iconOnly ? "sr-only" : undefined}>{label}</span>
      {direction === "newer" && (
        loading
          ? <LoaderCircle size={iconOnly ? 16 : 13} className="animate-spin motion-reduce:animate-none" />
          : <Icon size={iconOnly ? 16 : 13} />
      )}
    </button>
  );
}

export default function SnapshotNavigationControls({
  navigation,
  historical,
  mobile = false,
  context,
  onNavigate,
}: SnapshotNavigationControlsProps) {
  const iconOnly = mobile && !!context;
  const olderButton = (
    <SnapshotNavigationButton
      direction="older"
      label={historical || context ? "Older" : "Older snapshot"}
      navigation={navigation}
      mobile={mobile}
      iconOnly={iconOnly}
      stretch={historical && !context}
      onNavigate={onNavigate}
    />
  );
  const newerButton = historical ? (
    <SnapshotNavigationButton
      direction="newer"
      label={navigation.newerIsCurrent ? "Current" : "Newer"}
      navigation={navigation}
      mobile={mobile}
      iconOnly={iconOnly}
      stretch={!context}
      onNavigate={onNavigate}
    />
  ) : null;

  return (
    <div
      aria-busy={navigation.historyLoading || !!navigation.navigating || undefined}
      style={{ width: mobile || context ? "100%" : "auto", minWidth: 0 }}
    >
      {context ? (
        <div
          data-testid="snapshot-navigation-row"
          style={{
            width: "100%",
            display: "grid",
            gridTemplateColumns: iconOnly
              ? "var(--sp-touch-min) minmax(0, 1fr) var(--sp-touch-min)"
              : "minmax(0, 1fr) auto minmax(0, 1fr)",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div style={{ justifySelf: "start" }}>{olderButton}</div>
          <div style={{ width: "100%", minWidth: 0, justifySelf: "center" }}>{context}</div>
          <div style={{ justifySelf: "end" }}>{newerButton}</div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {olderButton}
          {newerButton}
        </div>
      )}
      {navigation.error && (
        <div
          role="status"
          style={{
            marginTop: 5,
            color: "var(--sp-rose)",
            fontSize: 9.5,
            lineHeight: 1.35,
            textAlign: mobile ? "left" : "right",
          }}
        >
          Couldn’t load snapshots. Try again or reopen Inbox.
        </div>
      )}
    </div>
  );
}
