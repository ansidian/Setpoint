import { AnimatePresence, motion as Motion, useReducedMotion } from "motion/react";
import { Check, Repeat } from "lucide-react";
import CalendarRecurrenceSection from "./CalendarRecurrenceSection";
import { formatRecurrenceSummary } from "./calendarEditorUtils";
import type { CalendarRecurrenceDraft } from "./calendarEventEditorModel";
import type useEventRecurrenceDraft from "./useEventRecurrenceDraft";
import "./calendarEventRecurrencePicker.css";

type EventRecurrenceDraftController = ReturnType<typeof useEventRecurrenceDraft>;

interface RecurrencePreset {
  value: string;
  label: string;
}

interface PresetButtonProps {
  option: RecurrencePreset;
  selected: boolean;
  disabled: boolean;
  onSelect: (frequency: string | null) => void;
}

interface CalendarEventRecurrencePickerProps {
  recurrenceDraft: CalendarRecurrenceDraft | null;
  startDate: string;
  disabled: boolean;
  onSelectPreset: EventRecurrenceDraftController["selectRecurrencePreset"];
  onUpdateRecurrence: EventRecurrenceDraftController["updateRecurrenceDraft"];
  onToggleWeekday: EventRecurrenceDraftController["toggleRecurrenceWeekday"];
  onClose: () => void;
}

const PRESETS = [
  { value: "", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

function PresetButton({ option, selected, disabled, onSelect }: PresetButtonProps) {
  return (
    <button
      type="button"
      className="calendar-event-recurrence-picker__preset"
      data-selected={selected}
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={() => onSelect(option.value)}
      style={{
        border: selected
          ? "1px solid color-mix(in srgb, var(--sp-accent) 34%, transparent)"
          : "1px solid rgba(255,255,255,0.06)",
        background: selected
          ? "color-mix(in srgb, var(--sp-accent) 13%, transparent)"
          : "rgba(255,255,255,0.03)",
        color: selected
          ? "color-mix(in srgb, var(--sp-accent) 55%, white)"
          : "rgba(205,214,244,0.78)",
      }}
    >
      <span>{option.label}</span>
      <Check size={13} style={{ color: selected ? "var(--sp-accent)" : "transparent" }} />
    </button>
  );
}

export default function CalendarEventRecurrencePicker({
  recurrenceDraft,
  startDate,
  disabled,
  onSelectPreset,
  onUpdateRecurrence,
  onToggleWeekday,
  onClose,
}: CalendarEventRecurrencePickerProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const selectedValue = recurrenceDraft?.frequency || "";
  const summary = formatRecurrenceSummary(recurrenceDraft, startDate) || "Does not repeat";

  return (
    <div
      data-suspend-calendar-hotkeys="true"
      data-testid="calendar-event-recurrence-picker"
      className="calendar-event-recurrence-picker"
      data-expanded={recurrenceDraft ? "true" : "false"}
    >
      <div className="calendar-event-recurrence-picker__workspace">
        <section className="calendar-event-recurrence-picker__presets" aria-label="Repeat frequency">
          <div className="calendar-event-recurrence-picker__heading">
            <span className="calendar-event-recurrence-picker__icon" aria-hidden>
              <Repeat size={12} />
            </span>
            <span>Repeat</span>
          </div>

          <div role="listbox" aria-label="Repeat presets" className="calendar-event-recurrence-picker__preset-list">
            {PRESETS.map((option) => (
              <PresetButton
                key={option.value || "none"}
                option={option}
                selected={selectedValue === option.value}
                disabled={disabled}
                onSelect={onSelectPreset}
              />
            ))}
          </div>
        </section>

        <AnimatePresence initial={false}>
          {recurrenceDraft ? (
            <Motion.section
              key="repeat-details"
              className="calendar-event-recurrence-picker__details"
              aria-label="Repeat details"
              initial={reducedMotion ? false : { opacity: 0, x: -10, clipPath: "inset(0 100% 0 0)" }}
              animate={{ opacity: 1, x: 0, clipPath: "inset(0 0% 0 0)" }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -8, clipPath: "inset(0 100% 0 0)" }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <div data-testid="calendar-event-repeat-summary" className="calendar-event-recurrence-picker__summary">
                {summary}
              </div>

              <CalendarRecurrenceSection
                key={recurrenceDraft.frequency}
                recurrenceDraft={recurrenceDraft}
                startDate={startDate}
                disabled={disabled}
                onUpdateRecurrence={onUpdateRecurrence}
                onToggleWeekday={onToggleWeekday}
                compact
              />
            </Motion.section>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="calendar-event-recurrence-picker__footer">
        <button
          type="button"
          className="calendar-event-recurrence-picker__done"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}
