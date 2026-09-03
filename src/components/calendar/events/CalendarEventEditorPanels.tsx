import { useCallback, useLayoutEffect, useRef } from "react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarEventCompactSchedulePicker from "./CalendarEventCompactSchedulePicker";
import CalendarEventRecurrencePicker from "./CalendarEventRecurrencePicker";
import CalendarConflictPanel from "./CalendarConflictPanel";
import CalendarLocationSuggestionsPanel from "./CalendarLocationSuggestionsPanel";
import SourcePickerPanel from "./CalendarSourcePickerPanel";
import { textFieldStyle } from "./calendarEditorUtils";
import type { CalendarDraftGhost } from "./CalendarDraftPreviewPanel";
import type useCalendarEditorPickers from "./useCalendarEditorPickers";
import type { CalendarSchedulePickerField } from "./useCalendarEditorPickers";
import type useCalendarEventEditor from "./useCalendarEventEditor";

interface CalendarEventEditorPanelsProps {
  editor: ReturnType<typeof useCalendarEventEditor>;
  pickers: ReturnType<typeof useCalendarEditorPickers>;
  ghost?: CalendarDraftGhost | null;
}

export default function CalendarEventEditorPanels({ editor, pickers, ghost = null }: CalendarEventEditorPanelsProps) {
  const {
    draft,
    sourceGroups,
    writableCalendars,
    locationSuggestions,
    locationSuggestionsLoading,
    locationSuggestionsError,
    activeLocationSuggestion,
    isEditing,
    updateField,
    updateRecurrenceDraft,
    selectRecurrencePreset,
    toggleRecurrenceWeekday,
    selectLocationSuggestion,
  } = editor;
  const schedulePickerField = typeof pickers.openPicker === "string" && pickers.openPicker.startsWith("schedule:")
    ? pickers.openPicker.slice("schedule:".length) as CalendarSchedulePickerField
    : null;
  const recurrenceAnchorRef = pickers.repeatRef.current?.isConnected
    ? pickers.repeatRef
    : pickers.sourceRef.current?.isConnected
      ? pickers.sourceRef
      : pickers.startDateRef;
  const locationInputRef = useRef<HTMLTextAreaElement>(null);

  const resizeLocationInput = useCallback((input: HTMLTextAreaElement | null) => {
    if (!input) return;
    const previousHeight = input.style.height ? parseFloat(getComputedStyle(input).height) : null;
    const transition = input.style.transition;
    // Measure unconstrained content without starting an intermediate auto-height
    // transition. Restore the visible pixel height before animating the target.
    input.style.transition = "none";
    input.style.height = "auto";
    const borderHeight = input.offsetHeight - input.clientHeight;
    const contentHeight = input.scrollHeight;
    const nextHeight = Math.min(Math.max(contentHeight + borderHeight, 38), 96);
    if (previousHeight !== null) {
      input.style.height = `${previousHeight}px`;
      void input.offsetHeight;
    }
    input.style.transition = transition;
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = contentHeight + borderHeight > 96 ? "auto" : "hidden";
  }, []);

  const setLocationInputRef = useCallback((input: HTMLTextAreaElement | null) => {
    locationInputRef.current = input;
    resizeLocationInput(input);
  }, [resizeLocationInput]);

  useLayoutEffect(() => {
    if (pickers.openPicker !== "location") return;
    resizeLocationInput(locationInputRef.current);
  }, [draft.location, pickers.openPicker, resizeLocationInput]);

  return (
    <>
      {schedulePickerField || pickers.showSourceSuggestions || pickers.showLocationSuggestions || pickers.openPicker === "recurrence" || (pickers.openPicker === "conflicts" && ghost) ? (
        <span hidden data-suspend-calendar-hotkeys="blocking" />
      ) : null}
      <AnchoredFloatingPanel
        anchorRef={pickers.startDateRef}
        ariaLabel="Compact schedule picker"
        open={!!schedulePickerField}
        animateDisclosure
        {...pickers.sharedSchedulePickerProps}
      >
        <CalendarEventCompactSchedulePicker
          draft={draft}
          updateField={(field, value) => {
            if (field === "allDay") updateField(field, value as boolean);
            else updateField(field, value as string);
          }}
          initialField={schedulePickerField ?? "startDate"}
          preserveDurationOnStartChange={isEditing}
          onClose={() => pickers.setOpenPicker(null)}
        />
      </AnchoredFloatingPanel>

      <AnchoredFloatingPanel
        anchorRef={pickers.sourceRef}
        ariaLabel="Calendar source picker"
        open={pickers.showSourceSuggestions}
        animateDisclosure
        {...pickers.sharedSourcePickerProps}
        onClose={pickers.closeSourceSuggestions}
      >
        <SourcePickerPanel
          sourceGroups={sourceGroups}
          writableCalendars={writableCalendars}
          selectedValue={draft.accountId && draft.calendarId ? `${draft.accountId}::${draft.calendarId}` : ""}
          activeValue={pickers.filteredSourceSuggestions[pickers.activeSourceSuggestion]?.value || null}
          filterQuery={pickers.showAutoSourceSuggestions ? pickers.parsedSourceQuery : ""}
          onSelect={pickers.selectSourceSuggestion}
        />
      </AnchoredFloatingPanel>

      <AnchoredFloatingPanel
        anchorRef={pickers.locationRef}
        ariaLabel="Location suggestions"
        open={pickers.showLocationSuggestions}
        animateDisclosure
        {...pickers.sharedLocationPickerProps}
        onClose={pickers.closeLocationSuggestions}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          {pickers.openPicker === "location" ? (
            <textarea
              ref={setLocationInputRef}
              autoFocus
              data-testid="calendar-event-location"
              aria-label="Event location"
              value={draft.location}
              onChange={(event) => updateField("location", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                }
                void pickers.handleLocationSuggestionKey(event);
              }}
              placeholder="Search places or type location"
              rows={1}
              style={{
                ...textFieldStyle(),
                display: "block",
                minHeight: 38,
                maxHeight: 96,
                resize: "none",
                overflowX: "hidden",
                overflowY: "hidden",
                lineHeight: 1.45,
                transition: "height var(--sp-motion-height) var(--sp-ease-height), background 140ms, border-color 140ms",
              }}
            />
          ) : null}
          {pickers.openPicker === "location" && draft.location?.trim() ? (
            <button
              type="button"
              onClick={() => updateField("location", "")}
              className="transition-[opacity,transform] duration-150 hover:-translate-y-px hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 active:opacity-60 motion-reduce:transform-none motion-reduce:transition-none"
              style={{
                alignSelf: "flex-start",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                color: "rgba(205,214,244,0.68)",
                borderRadius: 8,
                padding: "6px 9px",
                fontSize: 11,
                fontWeight: 650,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              Clear location
            </button>
          ) : null}
          <CalendarLocationSuggestionsPanel
            suggestions={locationSuggestions}
            loading={locationSuggestionsLoading}
            error={locationSuggestionsError}
            activeIndex={activeLocationSuggestion}
            onSelect={async (item) => {
              const resolved = await selectLocationSuggestion(item);
              if (resolved) pickers.consumeParsedLocationFromTitle();
              pickers.setOpenPicker(null);
            }}
          />
        </div>
      </AnchoredFloatingPanel>

      <AnchoredFloatingPanel
        anchorRef={recurrenceAnchorRef}
        ariaLabel="Recurrence picker"
        open={pickers.openPicker === "recurrence"}
        animateDisclosure
        {...pickers.sharedRecurrencePickerProps}
      >
        <CalendarEventRecurrencePicker
          recurrenceDraft={editor.recurrenceDraft}
          startDate={draft.startDate}
          disabled={!editor.editable}
          onSelectPreset={selectRecurrencePreset}
          onUpdateRecurrence={updateRecurrenceDraft}
          onToggleWeekday={toggleRecurrenceWeekday}
          onClose={() => pickers.setOpenPicker(null)}
        />
      </AnchoredFloatingPanel>

      <AnchoredFloatingPanel
        anchorRef={pickers.conflictRef}
        ariaLabel="Schedule conflicts"
        open={pickers.openPicker === "conflicts" && !!ghost}
        animateDisclosure
        {...pickers.sharedConflictPickerProps}
      >
        {ghost ? <CalendarConflictPanel ghost={ghost} /> : null}
      </AnchoredFloatingPanel>

    </>
  );
}
