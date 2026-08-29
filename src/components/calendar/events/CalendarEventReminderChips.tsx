import { AlertTriangle, Bell, Car, Clock3, Route, X } from "lucide-react";
import { ActionButton } from "./CalendarEditorControls";
import ReminderDateTimePicker from "../reminders/ReminderDateTimePicker";
import {
  type EventReminderLike,
  EVENT_REMINDER_PRESETS,
  projectEventReminderChips,
  projectTimeToLeaveDisplay,
} from "./calendarEventReminderModel";
import type useEventReminderDrafts from "./useEventReminderDrafts";

type EventReminderDraftController = ReturnType<typeof useEventReminderDrafts>;
type EventReminderChip = ReturnType<typeof projectEventReminderChips>[number];
const TIME_TO_LEAVE_BUFFER_PRESETS = [0, 15, 30] as const;

interface ReminderPillProps {
  chip: EventReminderChip;
  disabled: boolean;
  onRemove: EventReminderDraftController["removeEventReminder"];
}

interface CalendarEventReminderChipsProps {
  reminders: EventReminderLike[];
  reminderError: string | null;
  customReminder: EventReminderDraftController["customReminder"];
  disabled: boolean;
  presetStates?: Record<string | number, {
    disabled?: boolean;
    reason?: string | null;
  }>;
  onAddPreset: EventReminderDraftController["addEventReminderPreset"];
  onUpdateCustomReminder: EventReminderDraftController["updateCustomReminder"];
  onAddCustom: EventReminderDraftController["addCustomEventReminder"];
  onRemoveReminder: EventReminderDraftController["removeEventReminder"];
  timeToLeaveReminder?: EventReminderDraftController["timeToLeaveReminder"];
  timeToLeaveEligible?: boolean;
  onEnableTimeToLeave?: EventReminderDraftController["enableTimeToLeave"];
  onUpdateTimeToLeaveBuffer?: EventReminderDraftController["updateTimeToLeaveBuffer"];
  onRemoveTimeToLeave?: EventReminderDraftController["removeTimeToLeave"];
}

function disabledPresetTitle(reason?: string | null) {
  if (reason === "duplicate") return "That reminder is already on this event.";
  if (reason === "past") return "This preset would remind in the past.";
  if (reason === "missing_anchor") return "Choose an event start before adding a reminder.";
  return undefined;
}

function ReminderPill({ chip, disabled, onRemove }: ReminderPillProps) {
  const muted = chip.sent;
  return (
    <span
      data-testid="calendar-event-reminder-chip"
      data-reminder-status={chip.status}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 26,
        borderRadius: 999,
        border: muted ? "1px solid rgba(255,255,255,0.06)" : "1px solid color-mix(in srgb, var(--sp-accent) 22%, transparent)",
        background: muted ? "rgba(255,255,255,0.025)" : "color-mix(in srgb, var(--sp-accent) 10%, transparent)",
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
        className="transition-[background-color,color,transform] duration-150 hover:-translate-y-px hover:bg-white/[0.08] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-reduce:transform-none motion-reduce:transition-none"
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

export default function CalendarEventReminderChips({
  reminders,
  reminderError,
  customReminder,
  disabled,
  presetStates = {},
  onAddPreset,
  onUpdateCustomReminder,
  onAddCustom,
  onRemoveReminder,
  timeToLeaveReminder = null,
  timeToLeaveEligible = false,
  onEnableTimeToLeave = () => {},
  onUpdateTimeToLeaveBuffer = () => {},
  onRemoveTimeToLeave = async () => {},
}: CalendarEventReminderChipsProps) {
  const chips = projectEventReminderChips(reminders);
  const timeToLeave = projectTimeToLeaveDisplay(timeToLeaveReminder);
  const customTimeToLeaveBufferActive = !!timeToLeave && !TIME_TO_LEAVE_BUFFER_PRESETS.some(
    (minutes) => minutes === timeToLeave.arrivalBufferMinutes,
  );

  return (
    <section
      data-testid="calendar-event-reminders"
      aria-label="Event reminders"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.025)",
        borderRadius: 10,
        padding: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <Bell size={13} color="color-mix(in srgb, var(--sp-accent) 86%, transparent)" aria-hidden />
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
        {EVENT_REMINDER_PRESETS.map((preset) => {
          const state = presetStates[preset.offsetMinutes];
          const presetDisabled = disabled || !!state?.disabled;
          return (
            <ActionButton
              key={preset.offsetMinutes}
              subtle
              disabled={presetDisabled}
              title={disabledPresetTitle(state?.reason)}
              aria-label={`${preset.label} reminder preset`}
              dataTestId={`calendar-event-reminder-preset-${Math.abs(preset.offsetMinutes)}`}
              onClick={() => onAddPreset(preset.offsetMinutes)}
              style={{ padding: "6px 8px", fontSize: 10.5 }}
            >
              {preset.label}
            </ActionButton>
          );
        })}
        <ReminderDateTimePicker
          accent="var(--sp-accent)"
          ariaLabel="Custom event reminder picker"
          customReminder={customReminder}
          disabled={disabled}
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

      {timeToLeaveEligible ? (
        <div
          data-testid="calendar-time-to-leave"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 9,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            paddingTop: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--sp-text)", fontSize: 11, fontWeight: 700 }}>
                <Car size={13} color="var(--sp-orange)" aria-hidden />
                Time to Leave
              </div>
              <div style={{ marginTop: 3, color: "var(--color-text-faint)", fontSize: 10.5, lineHeight: 1.45 }}>
                Traffic-aware driving reminder from Home for this occurrence only.
              </div>
            </div>
            {!timeToLeave ? (
              <ActionButton
                subtle
                disabled={disabled}
                onClick={onEnableTimeToLeave}
                dataTestId="calendar-time-to-leave-enable"
                style={{ flexShrink: 0, padding: "6px 9px", fontSize: 10.5 }}
              >
                Enable · 15 min early
              </ActionButton>
            ) : null}
          </div>

          {!timeToLeave ? (
            <div style={{ color: "rgba(205,214,244,0.58)", fontSize: 10, lineHeight: 1.5 }}>
              Requires <a className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60" href="/settings?tab=connections#google-places" style={{ color: "var(--sp-accent)", textUnderlineOffset: 2 }}>Home + Google Maps Platform</a> and <a className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60" href="/settings?tab=connections#discord-reminders" style={{ color: "var(--sp-accent)", textUnderlineOffset: 2 }}>Discord Reminders</a>.
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                border: "1px solid color-mix(in srgb, var(--sp-orange) 20%, transparent)",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--sp-orange) 6%, transparent)",
                padding: 10,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7 }}>
                {timeToLeave.leaveBy && timeToLeave.durationMinutes != null ? (
                  <>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--sp-text)", fontSize: 11, fontWeight: 650 }}>
                      <Clock3 size={11} aria-hidden /> Leave by {timeToLeave.leaveBy}
                    </span>
                    <span style={{ color: "var(--color-text-faint)", fontSize: 10.5 }}>·</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "rgba(205,214,244,0.72)", fontSize: 10.5 }}>
                      <Route size={11} aria-hidden /> about {timeToLeave.durationMinutes} min drive
                    </span>
                  </>
                ) : (
                  <span style={{ color: "rgba(205,214,244,0.72)", fontSize: 10.5 }}>
                    A grounded drive estimate will be calculated when this event is saved.
                  </span>
                )}
                {timeToLeave.sent ? (
                  <span style={{ color: "var(--sp-green)", fontSize: 10, fontWeight: 700 }}>Sent</span>
                ) : timeToLeave.routeStatus === "degraded" || timeToLeave.routeStatus === "blocked" ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--sp-cream)", fontSize: 10, fontWeight: 700 }}>
                    <AlertTriangle size={10} aria-hidden /> Estimate needs refresh
                  </span>
                ) : timeToLeave.routeStatus === "ready" ? (
                  <span style={{ color: "var(--sp-green)", fontSize: 10, fontWeight: 700 }}>Traffic current</span>
                ) : (
                  <span style={{ color: "var(--sp-orange)", fontSize: 10, fontWeight: 700 }}>Pending save</span>
                )}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                <span style={{ color: "var(--color-text-faint)", fontSize: 10, fontWeight: 650 }}>Arrive early</span>
                {TIME_TO_LEAVE_BUFFER_PRESETS.map((minutes) => {
                  const selected = timeToLeave.arrivalBufferMinutes === minutes;
                  return (
                    <ActionButton
                      key={minutes}
                      subtle
                      aria-pressed={selected}
                      disabled={disabled || timeToLeave.sent}
                      onClick={() => onUpdateTimeToLeaveBuffer(minutes)}
                      style={{
                        padding: "5px 7px",
                        fontSize: 10,
                        ...(selected ? {
                          border: "1px solid color-mix(in srgb, var(--sp-orange) 52%, transparent)",
                          background: "color-mix(in srgb, var(--sp-orange) 11%, transparent)",
                          color: "var(--sp-orange)",
                        } : {}),
                      }}
                    >
                      {minutes} min
                    </ActionButton>
                  );
                })}
                <label style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  color: customTimeToLeaveBufferActive ? "var(--sp-orange)" : "var(--color-text-faint)",
                  fontSize: 10,
                }}>
                  Custom
                  <input
                    aria-label="Custom arrival buffer minutes"
                    data-selected={customTimeToLeaveBufferActive ? "true" : "false"}
                    type="number"
                    min={0}
                    max={120}
                    step={1}
                    disabled={disabled || timeToLeave.sent}
                    value={timeToLeave.arrivalBufferMinutes}
                    onChange={(event) => onUpdateTimeToLeaveBuffer(Number(event.target.value))}
                    className="text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                    style={{
                      width: 58,
                      minHeight: 30,
                      borderRadius: 7,
                      border: customTimeToLeaveBufferActive
                        ? "1px solid color-mix(in srgb, var(--sp-orange) 52%, transparent)"
                        : "1px solid rgba(255,255,255,0.09)",
                      background: customTimeToLeaveBufferActive
                        ? "color-mix(in srgb, var(--sp-orange) 11%, transparent)"
                        : "rgba(255,255,255,0.04)",
                      color: "var(--sp-text)",
                      padding: "4px 7px",
                      fontFamily: "inherit",
                    }}
                  />
                </label>
                <ActionButton
                  subtle
                  disabled={disabled || timeToLeave.sent}
                  onClick={onRemoveTimeToLeave}
                  dataTestId="calendar-time-to-leave-remove"
                  style={{ marginLeft: "auto", padding: "5px 7px", fontSize: 10, color: "var(--sp-rose)" }}
                >
                  Remove
                </ActionButton>
              </div>
            </div>
          )}
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
