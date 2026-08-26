import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarEventCompactSchedulePicker from "./CalendarEventCompactSchedulePicker";
import CalendarEventRecurrencePicker from "./CalendarEventRecurrencePicker";
import CalendarLocationSuggestionsPanel from "./CalendarLocationSuggestionsPanel";
import SourcePickerPanel from "./CalendarSourcePickerPanel";
import { textFieldStyle } from "./calendarEditorUtils";
import type useCalendarEditorPickers from "./useCalendarEditorPickers";
import type { CalendarSchedulePickerField } from "./useCalendarEditorPickers";
import type useCalendarEventEditor from "./useCalendarEventEditor";

interface CalendarEventEditorPanelsProps {
  editor: ReturnType<typeof useCalendarEventEditor>;
  pickers: ReturnType<typeof useCalendarEditorPickers>;
}

export default function CalendarEventEditorPanels({ editor, pickers }: CalendarEventEditorPanelsProps) {
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

  return (
    <>
      {schedulePickerField ? (
        <AnchoredFloatingPanel
          anchorRef={pickers.startDateRef}
          ariaLabel="Compact schedule picker"
          {...pickers.sharedSchedulePickerProps}
        >
          <CalendarEventCompactSchedulePicker
            draft={draft}
            updateField={(field, value) => {
              if (field === "allDay") updateField(field, value as boolean);
              else updateField(field, value as string);
            }}
            initialField={schedulePickerField}
            preserveDurationOnStartChange={isEditing}
            onClose={() => pickers.setOpenPicker(null)}
          />
        </AnchoredFloatingPanel>
      ) : null}

      {pickers.showSourceSuggestions ? (
        <AnchoredFloatingPanel
          anchorRef={pickers.sourceRef}
          ariaLabel="Calendar source picker"
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
      ) : null}

      {pickers.showLocationSuggestions ? (
        <AnchoredFloatingPanel
          anchorRef={pickers.locationRef}
          ariaLabel="Location suggestions"
          {...pickers.sharedLocationPickerProps}
          onClose={pickers.closeLocationSuggestions}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
            {pickers.openPicker === "location" ? (
              <input
                data-testid="calendar-event-location"
                aria-label="Event location"
                value={draft.location}
                onChange={(event) => updateField("location", event.target.value)}
                onKeyDown={pickers.handleLocationSuggestionKey}
                placeholder="Search places or type location"
                style={textFieldStyle()}
              />
            ) : null}
            {pickers.openPicker === "location" && draft.location?.trim() ? (
              <button
                type="button"
                onClick={() => updateField("location", "")}
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
      ) : null}

      {pickers.openPicker === "recurrence" ? (
        <AnchoredFloatingPanel
          anchorRef={recurrenceAnchorRef}
          ariaLabel="Recurrence picker"
          {...pickers.sharedRecurrencePickerProps}
        >
          <CalendarEventRecurrencePicker
            recurrenceDraft={editor.recurrenceDraft}
            startDate={draft.startDate}
            disabled={!editor.editable}
            onSelectPreset={selectRecurrencePreset}
            onUpdateRecurrence={updateRecurrenceDraft}
            onToggleWeekday={toggleRecurrenceWeekday}
          />
        </AnchoredFloatingPanel>
      ) : null}

    </>
  );
}
