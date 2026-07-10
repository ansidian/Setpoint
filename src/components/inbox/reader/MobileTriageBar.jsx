import { BellOff, Check, Clock, FileText, Trash2 } from "lucide-react";

function TriageButton({ icon, label, onClick, danger = false, disabled = false }) {
  const IconComponent = icon;
  return (
    <button
      type="button"
      className={`inbox-mobile-triage-button${danger ? " inbox-mobile-triage-button--danger" : ""}`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        minHeight: "var(--sp-touch-min)",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        padding: "6px 2px",
        border: `1px solid ${danger ? "color-mix(in srgb, var(--sp-rose) 18%, transparent)" : "rgba(255,255,255,0.06)"}`,
        borderRadius: 10,
        background: danger
          ? "color-mix(in srgb, var(--sp-rose) 8%, transparent)"
          : "rgba(255,255,255,0.025)",
        color: danger ? "var(--sp-rose)" : "rgba(205,214,244,0.8)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        fontFamily: "inherit",
        transform: "translateY(0)",
      }}
    >
      <IconComponent size={15} aria-hidden="true" />
      <span style={{ fontSize: 10, lineHeight: 1.1, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

export default function MobileTriageBar({ actions, onAction, onSnooze, snapshotPending = false }) {
  const hasVisibleAction = actions.canHandle
    || actions.canMoveToFyi
    || actions.canMoveToNoise
    || actions.showDestructiveActions;

  if (!hasVisibleAction) return null;

  return (
    <div
      data-testid="inbox-mobile-triage-bar"
      style={{
        display: "flex",
        gap: 4,
        padding: "0 16px 10px",
        flexShrink: 0,
      }}
    >
      {actions.canHandle && (
        <TriageButton icon={Check} label="Handled" disabled={snapshotPending} onClick={() => onAction("snapshot-handled")} />
      )}
      {actions.canMoveToFyi && (
        <TriageButton
          icon={FileText}
          label="FYI"
          disabled={snapshotPending}
          onClick={() => onAction("snapshot-move-lane", "fyi")}
        />
      )}
      {actions.canMoveToNoise && (
        <TriageButton
          icon={BellOff}
          label="Noise"
          disabled={snapshotPending}
          onClick={() => onAction("snapshot-move-lane", "noise")}
        />
      )}
      {actions.showDestructiveActions && (
        <TriageButton icon={Clock} label="Snooze" onClick={onSnooze} />
      )}
      {actions.showDestructiveActions && (
        <TriageButton icon={Trash2} label="Trash" danger onClick={() => onAction("trash")} />
      )}
    </div>
  );
}
