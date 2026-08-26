import { ActionButton } from "./CalendarEditorControls";
import type { CalendarMutationPhase } from "./calendarMutationCoordinator";

interface CalendarEventEditorStatusMessagesProps {
  error: string | null;
  errorCode: string | null;
  validationMessage: string | null;
  reconnect: () => void | Promise<void>;
  showValidation?: boolean;
  mutationPhase?: CalendarMutationPhase | null;
}

export default function CalendarEventEditorStatusMessages({
  error,
  errorCode,
  validationMessage,
  reconnect,
  showValidation = true,
  mutationPhase = null,
}: CalendarEventEditorStatusMessagesProps) {
  if (error) {
    const mapsError = errorCode?.startsWith("time_to_leave_") && [
      "time_to_leave_home_not_configured",
      "time_to_leave_maps_not_configured",
      "time_to_leave_routes_not_enabled",
      "time_to_leave_credential_rejected",
    ].includes(errorCode);
    return (
      <div
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid color-mix(in srgb, var(--sp-rose) 18%, transparent)",
          background: "color-mix(in srgb, var(--sp-rose) 8%, transparent)",
          color: "var(--sp-rose)",
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
        {mapsError ? (
          <div style={{ marginTop: 8 }}>
            <a
              href="/settings?tab=connections#google-places"
              className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              style={{ color: "var(--sp-accent)", fontWeight: 650, textUnderlineOffset: 3 }}
            >
              Open Google Maps Platform settings
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  if (mutationPhase === "verifying") {
    return (
      <div
        data-testid="calendar-event-verifying"
        role="status"
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid color-mix(in srgb, var(--sp-accent) 20%, transparent)",
          background: "color-mix(in srgb, var(--sp-accent) 7%, transparent)",
          color: "var(--color-text-secondary)",
          fontSize: 11.5,
          lineHeight: 1.5,
        }}
      >
        The request took longer than expected. Checking Google Calendar before changing anything back…
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
        border: "1px solid color-mix(in srgb, var(--sp-orange) 24%, transparent)",
        background: "color-mix(in srgb, var(--sp-orange) 8%, transparent)",
        color: "var(--sp-orange)",
        fontSize: 11.5,
        lineHeight: 1.5,
      }}
    >
      {validationMessage}
    </div>
  );
}
