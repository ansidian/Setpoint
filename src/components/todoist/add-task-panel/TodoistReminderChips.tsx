import type { ButtonHTMLAttributes, ComponentType, PropsWithChildren } from "react";
import { Bell, X } from "lucide-react";
import { ActionButton } from "../../calendar/events/CalendarEditorControls";
import ReminderDateTimePicker from "../../calendar/reminders/ReminderDateTimePicker.tsx";
import {
  projectTodoistReminderChips,
  TODOIST_REMINDER_PRESETS,
} from "./todoistReminderModel";
import type {
  CustomReminder,
  TodoistReminderBlockReason,
  TodoistReminderChip,
  TodoistReminderEntry,
  TodoistReminderPresetState,
} from "./types";

const TypedActionButton = ActionButton as ComponentType<PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & { subtle?: boolean; danger?: boolean; dataTestId?: string }
>>;

function disabledPresetTitle(reason: TodoistReminderBlockReason | null | undefined) {
  if (reason === "duplicate") return "That reminder is already on this task.";
  if (reason === "past") return "This preset would remind in the past.";
  if (reason === "missing_anchor") return "Choose a due date before adding a reminder.";
  return undefined;
}

function ReminderPill({
  chip,
  disabled,
  onRemove,
}: {
  chip: TodoistReminderChip;
  disabled: boolean;
  onRemove: (reminder: TodoistReminderEntry) => void;
}) {
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
        className="transition-[background-color,color,transform] duration-150 enabled:hover:-translate-y-px enabled:hover:!bg-white/[0.08] enabled:active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-reduce:transform-none motion-reduce:transition-none"
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          border: "1px solid transparent",
          background: "transparent",
          color: disabled || muted ? "rgba(205,214,244,0.28)" : "rgba(205,214,244,0.68)",
          display: "inline-grid",
          placeItems: "center",
          padding: 0,
          cursor: disabled || muted ? "not-allowed" : "pointer",
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
}: {
  reminders: TodoistReminderEntry[];
  reminderError: string | null;
  customReminder: CustomReminder;
  disabled: boolean;
  hasAnchor: boolean;
  compact?: boolean;
  presetStates?: Partial<Record<number, TodoistReminderPresetState>>;
  onAddPreset: (offsetMinutes: number) => void;
  onUpdateCustomReminder: (selection: CustomReminder) => void;
  onAddCustom: (selection: CustomReminder) => void;
  onRemoveReminder: (reminder: TodoistReminderEntry) => void;
}) {
  const chips = projectTodoistReminderChips(reminders);

  return (
    <section
      data-testid="todoist-reminders"
      aria-label="Deadline reminders"
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
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <Bell size={13} color="color-mix(in srgb, var(--sp-cream) 86%, transparent)" aria-hidden />
            <span style={{ color: "rgba(205,214,244,0.72)", fontSize: 11, fontWeight: 700 }}>
              Reminders
            </span>
          </div>
          <span style={{ paddingLeft: 20, color: "var(--color-text-faint)", fontSize: 9.5, lineHeight: 1.4 }}>
            Delivered via Discord. Separate from Todoist notifications.
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
          const state: Partial<TodoistReminderPresetState> = presetStates[preset.offsetMinutes] || {};
          const presetDisabled = disabled || !hasAnchor || !!state.disabled;
          return (
            <TypedActionButton
              key={preset.offsetMinutes}
              subtle
              disabled={presetDisabled}
              title={disabledPresetTitle(state.reason)}
              aria-label={`${preset.label} reminder preset`}
              dataTestId={`todoist-reminder-preset-${Math.abs(preset.offsetMinutes)}`}
              onClick={() => onAddPreset(preset.offsetMinutes)}
              style={{ padding: "6px 8px", fontSize: 10.5 }}
            >
              {preset.label}
            </TypedActionButton>
          );
        })}
        <ReminderDateTimePicker
          accent="var(--sp-cream)"
          ariaLabel="Custom deadline reminder picker"
          customReminder={customReminder}
          disabled={disabled || !hasAnchor}
          onSelect={(selection) => {
            onUpdateCustomReminder(selection);
            onAddCustom(selection);
          }}
        />
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

      {reminderError ? (
        <div style={{ color: "var(--sp-cream)", fontSize: 11, lineHeight: 1.35 }}>
          {reminderError}
        </div>
      ) : null}
    </section>
  );
}
