import { useState } from "react";
import { Bell, X } from "lucide-react";
import { ActionButton } from "../../calendar/events/CalendarEditorControls";
import ReminderDateTimePicker from "../../calendar/reminders/ReminderDateTimePicker.tsx";
import {
  projectTodoistReminderChips,
  TODOIST_REMINDER_PRESETS,
} from "./todoistReminderModel.js";

function disabledPresetTitle(reason) {
  if (reason === "duplicate") return "That reminder is already on this task.";
  if (reason === "past") return "This preset would remind in the past.";
  if (reason === "missing_anchor") return "Choose a due date before adding a reminder.";
  return undefined;
}

function ReminderPill({ chip, disabled, onRemove }) {
  const [hover, setHover] = useState(false);
  const muted = chip.sent;
  return (
    <span
      data-testid="todoist-reminder-chip"
      data-reminder-status={chip.status}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 26,
        borderRadius: 999,
        border: muted ? "1px solid rgba(255,255,255,0.06)" : "1px solid color-mix(in srgb, var(--sp-cream) 22%, transparent)",
        background: muted ? "rgba(255,255,255,0.025)" : "color-mix(in srgb, var(--sp-cream) 8%, transparent)",
        color: muted ? "var(--color-text-faint)" : "var(--sp-text)",
        padding: "3px 4px 3px 9px",
        fontSize: 11,
        fontWeight: 600,
        flex: "0 1 auto",
        minWidth: 0,
      }}
    >
      <Bell size={11} aria-hidden />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {chip.label}
      </span>
      {muted ? (
        <span style={{ color: "var(--color-text-faint)", fontSize: 10 }}>sent</span>
      ) : null}
      <button
        type="button"
        aria-label={`Remove reminder ${chip.label}`}
        disabled={disabled || muted}
        onClick={() => onRemove(chip.raw)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          border: "1px solid transparent",
          background: hover && !disabled && !muted ? "rgba(255,255,255,0.08)" : "transparent",
          color: disabled || muted ? "rgba(205,214,244,0.28)" : "rgba(205,214,244,0.68)",
          display: "inline-grid",
          placeItems: "center",
          padding: 0,
          cursor: disabled || muted ? "not-allowed" : "pointer",
          transform: hover && !disabled && !muted ? "translateY(-1px)" : "translateY(0)",
          transition: "transform 140ms, background 140ms, color 140ms",
        }}
      >
        <X size={11} aria-hidden />
      </button>
    </span>
  );
}

export default function TodoistReminderChips({
  reminders,
  reminderError,
  customReminder,
  disabled,
  hasAnchor,
  compact = false,
  presetStates = {},
  onAddPreset,
  onUpdateCustomReminder,
  onAddCustom,
  onRemoveReminder,
}) {
  const chips = projectTodoistReminderChips(reminders);

  return (
    <section
      data-testid="todoist-reminders"
      aria-label="Todoist reminders"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.025)",
        borderRadius: 10,
        padding: compact ? 9 : 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <Bell size={13} color="color-mix(in srgb, var(--sp-cream) 86%, transparent)" aria-hidden />
          <span style={{ color: "rgba(205,214,244,0.72)", fontSize: 11, fontWeight: 700 }}>
            Reminders
          </span>
        </div>
        {chips.length ? (
          <span style={{ color: "var(--color-text-faint)", fontSize: 10, fontWeight: 600 }}>
            {chips.length}
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {TODOIST_REMINDER_PRESETS.map((preset) => {
          const state = presetStates[preset.offsetMinutes] || {};
          const presetDisabled = disabled || !hasAnchor || !!state.disabled;
          return (
            <ActionButton
              key={preset.offsetMinutes}
              subtle
              disabled={presetDisabled}
              title={disabledPresetTitle(state.reason)}
              aria-label={`${preset.label} Todoist reminder preset`}
              dataTestId={`todoist-reminder-preset-${Math.abs(preset.offsetMinutes)}`}
              onClick={() => onAddPreset(preset.offsetMinutes)}
              style={{ padding: "6px 8px", fontSize: 10.5 }}
            >
              {preset.label}
            </ActionButton>
          );
        })}
      </div>

      {chips.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((chip) => (
            <ReminderPill
              key={chip.key}
              chip={chip}
              disabled={disabled}
              onRemove={onRemoveReminder}
            />
          ))}
        </div>
      ) : null}

      <ReminderDateTimePicker
        accent="var(--sp-cream)"
        ariaLabel="Custom Todoist reminder picker"
        customReminder={customReminder}
        disabled={disabled || !hasAnchor}
        onSelect={(selection) => {
          onUpdateCustomReminder(selection);
          onAddCustom(selection);
        }}
      />

      {reminderError ? (
        <div style={{ color: "var(--sp-cream)", fontSize: 11, lineHeight: 1.35 }}>
          {reminderError}
        </div>
      ) : null}
    </section>
  );
}
