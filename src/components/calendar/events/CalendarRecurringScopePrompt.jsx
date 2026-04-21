import { RECURRING_SCOPE_OPTIONS } from "./calendarEditorUtils";

export default function CalendarRecurringScopePrompt({
  selectedScope,
  disabled = false,
  onSelectScope,
}) {
  return (
    <div
      data-testid="calendar-recurring-scope-prompt"
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.03)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
          Edit recurring event
        </div>
        <div style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.5 }}>
          Choose how broadly these changes should apply before saving or deleting.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        {RECURRING_SCOPE_OPTIONS.map((option) => {
          const selected = selectedScope === option.value;
          return (
            <button
              key={option.value}
              type="button"
              data-testid={`calendar-recurring-scope-${option.value}`}
              disabled={disabled}
              onClick={() => onSelectScope(option.value)}
              onMouseEnter={(event) => {
                if (disabled) return;
                event.currentTarget.style.transform = "translateY(-1px)";
                if (!selected) {
                  event.currentTarget.style.background = "rgba(255,255,255,0.06)";
                  event.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
                }
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.transform = "translateY(0)";
                event.currentTarget.style.background = selected ? "rgba(203,166,218,0.14)" : "rgba(255,255,255,0.03)";
                event.currentTarget.style.borderColor = selected ? "rgba(203,166,218,0.34)" : "rgba(255,255,255,0.08)";
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "12px 12px 11px",
                borderRadius: 10,
                border: selected
                  ? "1px solid rgba(203,166,218,0.34)"
                  : "1px solid rgba(255,255,255,0.08)",
                background: selected ? "rgba(203,166,218,0.14)" : "rgba(255,255,255,0.03)",
                color: selected ? "#cba6da" : "#cdd6f4",
                textAlign: "left",
                cursor: disabled ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                transform: "translateY(0)",
                transition: "transform 140ms, background 140ms, border-color 140ms",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {option.label}
              </span>
              <span style={{ fontSize: 10.5, lineHeight: 1.45, color: selected ? "rgba(203,166,218,0.86)" : "rgba(205,214,244,0.55)" }}>
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
