import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarDateTimeView from "@/components/shared/pickers/CalendarDateTimeView";
import TimePickerView from "@/components/shared/pickers/TimePickerView";
import CalendarLocationSuggestionsPanel from "./CalendarLocationSuggestionsPanel";
import SourcePickerPanel from "./CalendarSourcePickerPanel";
import {
  ACCENT,
  toPacificYmd,
  addMinutesToDraftDateTime,
} from "./calendarEditorUtils";

export default function CalendarEventEditorPanels({ editor, pickers }) {
  const {
    draft,
    sourceGroups,
    writableCalendars,
    locationSuggestions,
    locationSuggestionsLoading,
    locationSuggestionsError,
    activeLocationSuggestion,
    updateField,
    selectLocationSuggestion,
  } = editor;

  return (
    <>
      {pickers.openPicker === "startDate" ? (
        <AnchoredFloatingPanel
          anchorRef={pickers.startDateRef}
          ariaLabel="Start date picker"
          {...pickers.sharedDatePickerProps}
        >
          <CalendarDateTimeView
            nowTick={pickers.nowTick}
            initialEpoch={new Date(`${draft.startDate || draft.endDate || "2026-01-01"}T12:00:00Z`).getTime()}
            onSelect={(epoch) => {
              updateField("startDate", toPacificYmd(epoch));
              pickers.setOpenPicker("endDate");
            }}
            onBack={() => pickers.setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set start date"
            mode="date-only"
            allowPastDates
            submitOnDateSelect
          />
        </AnchoredFloatingPanel>
      ) : null}

      {pickers.openPicker === "endDate" ? (
        <AnchoredFloatingPanel
          anchorRef={pickers.endDateRef}
          ariaLabel="End date picker"
          {...pickers.sharedDatePickerProps}
        >
          <CalendarDateTimeView
            nowTick={pickers.nowTick}
            initialEpoch={new Date(`${draft.endDate || draft.startDate || "2026-01-01"}T12:00:00Z`).getTime()}
            onSelect={(epoch) => {
              updateField("endDate", toPacificYmd(epoch));
              pickers.setOpenPicker(null);
            }}
            onBack={() => pickers.setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set end date"
            mode="date-only"
            allowPastDates
            submitOnDateSelect
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
          <CalendarLocationSuggestionsPanel
            suggestions={locationSuggestions}
            loading={locationSuggestionsLoading}
            error={locationSuggestionsError}
            activeIndex={activeLocationSuggestion}
            onSelect={async (item) => {
              await selectLocationSuggestion(item);
              pickers.consumeParsedLocationFromTitle();
              pickers.setOpenPicker(null);
            }}
          />
        </AnchoredFloatingPanel>
      ) : null}

      {pickers.openPicker === "startTime" ? (
        <AnchoredFloatingPanel
          anchorRef={pickers.startTimeRef}
          ariaLabel="Start time picker"
          {...pickers.sharedTimePickerProps}
        >
          <TimePickerView
            initialTime={draft.startTime}
            onSelect={(value) => {
              updateField("startTime", value);
              const seededEnd = addMinutesToDraftDateTime(draft.startDate, value, 30);
              const shouldSyncEndDate = !draft.endDate
                || draft.endDate === draft.startDate
                || draft.endDate < seededEnd.date;
              if (shouldSyncEndDate) {
                updateField("endDate", seededEnd.date);
              }
              updateField("endTime", seededEnd.time);
              pickers.setOpenPicker("endTime");
            }}
            onBack={() => pickers.setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set start time"
          />
        </AnchoredFloatingPanel>
      ) : null}

      {pickers.openPicker === "endTime" ? (
        <AnchoredFloatingPanel
          anchorRef={pickers.endTimeRef}
          ariaLabel="End time picker"
          {...pickers.sharedTimePickerProps}
        >
          <TimePickerView
            initialTime={draft.endTime}
            onSelect={(value) => {
              updateField("endTime", value);
              pickers.setOpenPicker(null);
            }}
            onBack={() => pickers.setOpenPicker(null)}
            accent={ACCENT}
            confirmLabel="Set end time"
          />
        </AnchoredFloatingPanel>
      ) : null}
    </>
  );
}
