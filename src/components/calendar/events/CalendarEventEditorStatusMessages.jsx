import { ActionButton } from "./CalendarEditorControls";

export default function CalendarEventEditorStatusMessages({
  error,
  errorCode,
  validationMessage,
  reconnect,
  showValidation = true,
}) {
  if (error) {
    return (
      <div
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid rgba(243,139,168,0.18)",
          background: "rgba(243,139,168,0.08)",
          color: "#f5c2e7",
          fontSize: 11.5,
          lineHeight: 1.5,
        }}
      >
        <div>{error}</div>
        {errorCode === "calendar_reauth_required" ? (
          <div style={{ marginTop: 8 }}>
            <ActionButton onClick={reconnect}>Reconnect Gmail</ActionButton>
          </div>
        ) : null}
      </div>
    );
  }

  if (!validationMessage || !showValidation) return null;

  return (
    <div
      data-testid="calendar-event-validation"
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid rgba(249,115,22,0.24)",
        background: "rgba(249,115,22,0.08)",
        color: "#fdba74",
        fontSize: 11.5,
        lineHeight: 1.5,
      }}
    >
      {validationMessage}
    </div>
  );
}
