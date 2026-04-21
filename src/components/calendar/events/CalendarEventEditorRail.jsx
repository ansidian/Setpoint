import { useState } from "react";
import { CalendarDays, Calendar as CalendarIcon, Clock3, MapPin } from "lucide-react";
import AnchoredFloatingPanel from "@/components/shared/pickers/AnchoredFloatingPanel";
import CalendarDateTimeView from "@/components/shared/pickers/CalendarDateTimeView";
import TimePickerView from "@/components/shared/pickers/TimePickerView";
import CalendarLocationSuggestionsPanel from "./CalendarLocationSuggestionsPanel";
import CalendarBatchReviewSection from "./CalendarBatchReviewSection";
import CalendarRecurrenceSection, { formatRecurrenceSummary } from "./CalendarRecurrenceSection";
import CalendarRecurringScopePrompt, { recurringScopeLabel } from "./CalendarRecurringScopePrompt";
import SourcePickerPanel from "./CalendarSourcePickerPanel";
import { FieldLabel, ActionButton, PickerFieldButton } from "./CalendarEditorControls";
import DetailSummaryRow from "./CalendarEventDetailSummary";
import useCalendarEditorPickers from "./useCalendarEditorPickers";
import {
  ACCENT,
  toPacificYmd,
  formatDateLabel,
  formatTimeLabel,
  addMinutesToDraftDateTime,
  sourceDotStyle,
  textFieldStyle,
} from "./calendarEditorUtils";

export default function CalendarEventEditorRail({ editor }) {
  const {
    draft,
    titleInput,
    titleAssist,
    intentState,
    batchDrafts,
    recurrenceDraft,
    recurringEditScope,
    writableCalendars,
    sourceGroups,
    sourcesLoading,
    error,
    errorCode,
    validationMessage,
    canSave,
    saving,
    deleting,
    confirmDelete,
    isEditing,
    isEditingRecurring,
    locationSuggestions,
    locationSuggestionsLoading,
    locationSuggestionsError,
    activeLocationSuggestion,
    updateField,
    updateBatchDraft,
    removeBatchDraft,
    updateRecurrenceDraft,
    toggleRecurrenceWeekday,
    selectRecurringEditScope,
    selectLocationSuggestion,
    save,
    closeEditor,
    confirmDeleteIntent,
    cancelDelete,
    remove,
    reconnect,
  } = editor;

  const pickers = useCalendarEditorPickers(editor);

  const disabled = saving || deleting;
  const saveDisabled = disabled || !canSave;
  const isBatchMode = !isEditing && intentState.mode === "batch";
  const isRecurringMode = !isEditing && intentState.mode === "recurring";
  const showRecurringScopePrompt = isEditingRecurring;
  const showRecurringBuilder = recurrenceDraft && (
    isRecurringMode || (isEditingRecurring && !!recurringEditScope && recurringEditScope !== "one")
  );
  const isCompactMode = isBatchMode || isRecurringMode;
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const showDetailFields = !isCompactMode || detailsExpanded;

  return (
    <div
      data-testid="calendar-event-editor-rail"
      style={{ padding: "16px 20px", overflow: "auto", flex: 1 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, color: "#cba6da", fontWeight: 500 }}>
            {isEditing ? "Edit event" : isBatchMode ? "New batch" : "New event"}
          </div>
          <div style={{ marginTop: 3, fontSize: 11, color: "rgba(205,214,244,0.42)", lineHeight: 1.45 }}>
            {isEditing
              ? isEditingRecurring
                ? recurringEditScope
                  ? `Applying changes to ${recurringScopeLabel(recurringEditScope).toLowerCase()}.`
                  : "This is a recurring event."
                : "Edit this event directly from the dashboard."
              : isBatchMode
                ? `${batchDrafts.length} one-off event${batchDrafts.length === 1 ? "" : "s"} ready for review before creating.`
                : isRecurringMode
                  ? "Structured recurrence is ready to review before creating the series."
                  : "Natural language can create a single event, a batch of one-offs, or a recurring draft."}
          </div>
        </div>
      </div>

      {showRecurringScopePrompt ? (
        <CalendarRecurringScopePrompt
          selectedScope={recurringEditScope}
          disabled={disabled}
          onSelectScope={selectRecurringEditScope}
        />
      ) : null}

      {error ? (
        <div
          style={{
            marginTop: 14,
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
      ) : null}

      {!error && validationMessage && !(isEditingRecurring && !recurringEditScope) ? (
        <div
          data-testid="calendar-event-validation"
          style={{
            marginTop: 14,
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
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
        <div>
          <FieldLabel>Title</FieldLabel>
          <input
            ref={pickers.titleRef}
            data-testid="calendar-event-title"
            type="text"
            value={titleInput}
            onKeyDown={pickers.onTitleKeyDown}
            onChange={pickers.onTitleChange}
            disabled={disabled}
            placeholder={isEditing ? "Event title" : "Dinner on Tue at 5pm"}
            style={textFieldStyle({ invalid: validationMessage === "Title is required." })}
          />
          {pickers.showTitleAssist ? (
            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.05)",
                background: "rgba(255,255,255,0.03)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {titleAssist.preview ? (
                <div
                  data-testid="calendar-event-title-preview"
                  style={{ fontSize: 11.5, color: "rgba(205,214,244,0.78)", lineHeight: 1.45 }}
                >
                  Parsed schedule: <span style={{ color: "#cba6da" }}>{titleAssist.preview}</span>
                </div>
              ) : null}
              {!isEditing && intentState.mode === "batch" ? (
                <div
                  data-testid="calendar-event-title-mode-preview"
                  style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.45 }}
                >
                  Parsed intent: <span style={{ color: "#89dceb" }}>{batchDrafts.length} one-off events</span>
                </div>
              ) : null}
              {!isEditing && intentState.mode === "recurring" ? (
                <div
                  data-testid="calendar-event-title-mode-preview"
                  style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.45 }}
                >
                  Parsed intent: <span style={{ color: "#89dceb" }}>recurring event</span>
                </div>
              ) : null}
              {titleAssist.locationQuery ? (
                <div
                  data-testid="calendar-event-title-location-preview"
                  style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.45 }}
                >
                  Parsed location query: <span style={{ color: "#f5c2e7" }}>{titleAssist.locationQuery}</span>
                </div>
              ) : null}
              {titleAssist.sourceQuery ? (
                <div
                  data-testid="calendar-event-title-source-preview"
                  style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.45 }}
                >
                  Parsed calendar source: <span style={{ color: "#89dceb" }}>{titleAssist.sourceQuery}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div>
          <FieldLabel>Calendar</FieldLabel>
          <input
            data-testid="calendar-event-source"
            type="hidden"
            value={draft.accountId && draft.calendarId ? `${draft.accountId}::${draft.calendarId}` : ""}
            readOnly
          />
          <PickerFieldButton
            anchorRef={pickers.sourceRef}
            icon={CalendarIcon}
            value={pickers.selectedSource?.label || (sourcesLoading ? "Loading calendars..." : "")}
            placeholder={writableCalendars.length ? "Choose a calendar" : "No writable calendars"}
            dataTestId="calendar-event-source-trigger"
            onClick={() => !disabled && pickers.setOpenPicker("source")}
            disabled={disabled || sourcesLoading || writableCalendars.length === 0}
            invalid={pickers.missingCalendar}
            trailingLabel=""
            leading={pickers.selectedSource ? (
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  display: "inline-grid",
                  placeItems: "center",
                  background: `color-mix(in srgb, ${pickers.selectedSource.color} 16%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${pickers.selectedSource.color} 28%, transparent)`,
                  flexShrink: 0,
                }}
              >
                <span style={sourceDotStyle(pickers.selectedSource.color)} />
              </span>
            ) : null}
          />
        </div>

        {isCompactMode ? (
          <DetailSummaryRow
            draft={draft}
            recurrenceSummary={isRecurringMode ? formatRecurrenceSummary(recurrenceDraft, draft.startDate) : ""}
            expanded={detailsExpanded}
            onToggle={() => setDetailsExpanded((prev) => !prev)}
          />
        ) : null}

        {showDetailFields ? (
          <>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "rgba(205,214,244,0.72)",
              }}
            >
              <input
                data-testid="calendar-event-all-day"
                type="checkbox"
                checked={draft.allDay}
                onChange={(event) => {
                  const nextAllDay = event.target.checked;
                  if (nextAllDay && (pickers.openPicker === "startTime" || pickers.openPicker === "endTime")) {
                    pickers.setOpenPicker(null);
                  }
                  updateField("allDay", nextAllDay);
                }}
                disabled={disabled}
                style={{ accentColor: "#cba6da" }}
              />
              All day
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <FieldLabel>Start</FieldLabel>
                <PickerFieldButton
                  anchorRef={pickers.startDateRef}
                  icon={CalendarDays}
                  value={formatDateLabel(draft.startDate)}
                  placeholder="Choose date"
                  dataTestId="calendar-event-start-date"
                  onClick={() => !disabled && pickers.setOpenPicker("startDate")}
                  disabled={disabled}
                  invalid={pickers.invalidDateRange}
                  trailingLabel=""
                />
              </div>
              <div>
                <FieldLabel>End</FieldLabel>
                <PickerFieldButton
                  anchorRef={pickers.endDateRef}
                  icon={CalendarDays}
                  value={formatDateLabel(draft.endDate)}
                  placeholder="Choose date"
                  dataTestId="calendar-event-end-date"
                  onClick={() => !disabled && pickers.setOpenPicker("endDate")}
                  disabled={disabled}
                  invalid={pickers.invalidDateRange}
                  trailingLabel=""
                />
              </div>
            </div>

            {!draft.allDay ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <FieldLabel>Start time</FieldLabel>
                  <PickerFieldButton
                    anchorRef={pickers.startTimeRef}
                    icon={Clock3}
                    value={formatTimeLabel(draft.startTime)}
                    placeholder="Choose time"
                    dataTestId="calendar-event-start-time"
                    onClick={() => !disabled && pickers.setOpenPicker("startTime")}
                    disabled={disabled}
                    invalid={pickers.invalidTimeRange}
                    trailingLabel=""
                  />
                </div>
                <div>
                  <FieldLabel>End time</FieldLabel>
                  <PickerFieldButton
                    anchorRef={pickers.endTimeRef}
                    icon={Clock3}
                    value={formatTimeLabel(draft.endTime)}
                    placeholder="Choose time"
                    dataTestId="calendar-event-end-time"
                    onClick={() => !disabled && pickers.setOpenPicker("endTime")}
                    disabled={disabled}
                    invalid={pickers.invalidTimeRange}
                    trailingLabel=""
                  />
                </div>
              </div>
            ) : null}

            <div>
              <FieldLabel>Location</FieldLabel>
              <input
                ref={pickers.locationRef}
                data-testid="calendar-event-location"
                type="text"
                value={draft.location}
                onFocus={() => {
                  if (!disabled) pickers.setOpenPicker("location");
                }}
                onChange={(event) => {
                  updateField("location", event.target.value);
                  if (!disabled) pickers.setOpenPicker("location");
                }}
                onKeyDown={async (event) => {
                  if (await pickers.handleLocationSuggestionKey(event)) return;
                  event.stopPropagation();
                }}
                disabled={disabled}
                placeholder="Search for a place or type your own"
                style={textFieldStyle()}
              />
              {!locationSuggestionsError ? (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 10.5,
                    color: "rgba(205,214,244,0.45)",
                    lineHeight: 1.45,
                  }}
                >
                  Nearby suggestions are biased to your saved weather location.
                </div>
              ) : null}
            </div>

            <div>
              <FieldLabel>Notes</FieldLabel>
              <textarea
                data-testid="calendar-event-description"
                value={draft.description}
                onKeyDown={(event) => event.stopPropagation()}
                onChange={(event) => updateField("description", event.target.value)}
                disabled={disabled}
                rows={isCompactMode ? 3 : 5}
                placeholder="Optional"
                style={{ ...textFieldStyle(), resize: "vertical", minHeight: isCompactMode ? 60 : 120 }}
              />
            </div>
          </>
        ) : null}
      </div>

      {isBatchMode ? (
        <CalendarBatchReviewSection
          batchDrafts={batchDrafts}
          allDay={draft.allDay}
          disabled={disabled}
          onUpdateDraft={updateBatchDraft}
          onRemoveDraft={removeBatchDraft}
        />
      ) : null}

      {showRecurringBuilder ? (
        <CalendarRecurrenceSection
          recurrenceDraft={recurrenceDraft}
          startDate={draft.startDate}
          disabled={disabled}
          onUpdateRecurrence={updateRecurrenceDraft}
          onToggleWeekday={toggleRecurrenceWeekday}
        />
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        {confirmDelete ? (
          <>
            <ActionButton
              dataTestId="calendar-event-delete-confirm"
              danger
              onClick={remove}
              disabled={disabled}
            >
              {deleting ? "Deleting..." : "Confirm delete"}
            </ActionButton>
            <ActionButton subtle onClick={cancelDelete} disabled={disabled}>
              Keep event
            </ActionButton>
          </>
        ) : (
          <>
            <ActionButton
              dataTestId="calendar-event-save"
              onClick={save}
              disabled={saveDisabled}
            >
              {saving ? "Saving..." : isEditing ? "Save changes" : isBatchMode ? (batchDrafts.some((d) => d.error) ? `Retry ${batchDrafts.length} event${batchDrafts.length === 1 ? "" : "s"}` : `Create ${batchDrafts.length} event${batchDrafts.length === 1 ? "" : "s"}`) : isRecurringMode ? "Create recurring event" : "Create event"}
            </ActionButton>
            <ActionButton subtle onClick={closeEditor} disabled={disabled}>
              Cancel
            </ActionButton>
            {isEditing ? (
              <ActionButton
                dataTestId="calendar-event-delete"
                danger
                onClick={confirmDeleteIntent}
                disabled={disabled || (isEditingRecurring && !recurringEditScope)}
              >
                Delete
              </ActionButton>
            ) : null}
          </>
        )}
      </div>

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
    </div>
  );
}
