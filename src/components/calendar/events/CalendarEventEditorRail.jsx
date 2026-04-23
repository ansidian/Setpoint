import { useState } from "react";
import { AnimatePresence, motion as Motion } from "motion/react";
import { CalendarDays, Calendar as CalendarIcon, Clock3 } from "lucide-react";
import CalendarBatchReviewSection from "./CalendarBatchReviewSection";
import CalendarRecurrenceSection from "./CalendarRecurrenceSection";
import CalendarRecurringScopePrompt from "./CalendarRecurringScopePrompt";
import { FieldLabel, ActionButton, PickerFieldButton } from "./CalendarEditorControls";
import CalendarEventEditorActionBar from "./CalendarEventEditorActionBar";
import DetailSummaryRow from "./CalendarEventDetailSummary";
import CalendarEventEditorPanels from "./CalendarEventEditorPanels";
import useCalendarEditorPickers from "./useCalendarEditorPickers";
import {
  formatDateLabel,
  formatTimeLabel,
  formatRecurrenceSummary,
  recurringScopeLabel,
  sourceDotStyle,
  textFieldStyle,
} from "./calendarEditorUtils";

const editorModeTransition = {
  duration: 0.26,
  ease: [0.22, 1, 0.36, 1],
};

const editorModeLayoutTransition = {
  type: "spring",
  stiffness: 260,
  damping: 28,
  mass: 0.92,
  bounce: 0,
};

function editorSurfaceStyle() {
  return {
    padding: 14,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.05)",
    background: "rgba(255,255,255,0.02)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minWidth: 0,
  };
}

function sectionIntroStyle() {
  return {
    fontSize: 11.5,
    lineHeight: 1.5,
    color: "rgba(205,214,244,0.56)",
  };
}

export default function CalendarEventEditorRail({ editor, expandedDesktop = false }) {
  const {
    draft,
    titleInput,
    titleAssist,
    intentState,
    batchDrafts,
    recurrenceDraft,
    recurringEditScope,
    writableCalendars,
    sourcesLoading,
    error,
    errorCode,
    validationMessage,
    canSave,
    saving,
    deleting,
    isEditing,
    isEditingRecurring,
    locationSuggestionsError,
    updateField,
    updateBatchDraft,
    removeBatchDraft,
    updateRecurrenceDraft,
    toggleRecurrenceWeekday,
    selectRecurringEditScope,
    reconnect,
  } = editor;

  const pickers = useCalendarEditorPickers(editor);
  const {
    openPicker,
    setOpenPicker,
    titleRef,
    sourceRef,
    locationRef,
    startDateRef,
    endDateRef,
    startTimeRef,
    endTimeRef,
    missingCalendar,
    selectedSource,
    invalidDateRange,
    invalidTimeRange,
    showTitleAssist,
    onTitleKeyDown,
    onTitleChange,
    handleLocationSuggestionKey,
  } = pickers;

  const disabled = saving || deleting;
  const saveDisabled = disabled || !canSave;
  const isBatchMode = intentState.mode === "batch";
  const isRecurringMode = intentState.mode === "recurring";
  const showRecurringScopePrompt = isEditingRecurring;
  const showRecurringBuilder = recurrenceDraft && (
    isRecurringMode || (isEditingRecurring && !!recurringEditScope && recurringEditScope !== "one")
  );
  const isCompactMode = isBatchMode || isRecurringMode;
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const showDetailFields = !isCompactMode || detailsExpanded;
  const useDesktopStage = expandedDesktop && showDetailFields;
  const editorModeKey = isEditing
    ? (showRecurringBuilder ? "edit-recurring" : "edit-single")
    : isBatchMode
      ? "create-batch"
      : isRecurringMode
        ? "create-recurring"
        : "create-single";

  return (
    <div
      data-testid="calendar-event-editor-rail"
      data-editor-layout={useDesktopStage ? "desktop-staged" : expandedDesktop ? "desktop-collapsed" : "stacked"}
      data-calendar-local-scroll="true"
      style={{
        padding: expandedDesktop ? "18px 22px 20px" : "16px 20px",
        overflow: "auto",
        overscrollBehavior: "contain",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
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

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16, flex: 1, minHeight: 0 }}>
        <div>
          <FieldLabel>Title</FieldLabel>
          <input
            ref={titleRef}
            data-testid="calendar-event-title"
            type="text"
            value={titleInput}
            onKeyDown={onTitleKeyDown}
            onChange={onTitleChange}
            disabled={disabled}
            placeholder={isEditing ? "Event title" : "Dinner on Tue at 5pm"}
            style={textFieldStyle({ invalid: validationMessage === "Title is required." })}
          />
        </div>

        <Motion.div
          layout
          transition={editorModeLayoutTransition}
          style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0 }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <Motion.div
              key={editorModeKey}
              data-testid={`calendar-event-editor-mode-${editorModeKey}`}
              layout
              initial={{ opacity: 0, y: 18, scale: 0.984 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.992 }}
              transition={{
                layout: editorModeLayoutTransition,
                opacity: editorModeTransition,
                y: editorModeTransition,
                scale: editorModeTransition,
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                flex: 1,
                minHeight: 0,
                transformOrigin: "top center",
                willChange: "opacity, transform",
              }}
            >
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

              {showTitleAssist ? (
                <div
                  style={{
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
                  {intentState.mode === "batch" ? (
                    <div
                      data-testid="calendar-event-title-mode-preview"
                      style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)", lineHeight: 1.45 }}
                    >
                      Parsed intent: <span style={{ color: "#89dceb" }}>{batchDrafts.length} one-off events</span>
                    </div>
                  ) : null}
                  {intentState.mode === "recurring" ? (
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

              <div>
                <FieldLabel>Calendar</FieldLabel>
                <input
                  data-testid="calendar-event-source"
                  type="hidden"
                  value={draft.accountId && draft.calendarId ? `${draft.accountId}::${draft.calendarId}` : ""}
                  readOnly
                />
                <PickerFieldButton
                  anchorRef={sourceRef}
                  icon={CalendarIcon}
                  value={selectedSource?.label || (sourcesLoading ? "Loading calendars..." : "")}
                  placeholder={writableCalendars.length ? "Choose a calendar" : "No writable calendars"}
                  dataTestId="calendar-event-source-trigger"
                  onClick={() => !disabled && setOpenPicker("source")}
                  disabled={disabled || sourcesLoading || writableCalendars.length === 0}
                  invalid={missingCalendar}
                  trailingLabel=""
                  leading={selectedSource ? (
                    <span
                      aria-hidden
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 7,
                        display: "inline-grid",
                        placeItems: "center",
                        background: `color-mix(in srgb, ${selectedSource.color} 16%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${selectedSource.color} 28%, transparent)`,
                        flexShrink: 0,
                      }}
                    >
                      <span style={sourceDotStyle(selectedSource.color)} />
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

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  flex: 1,
                  minHeight: 0,
                }}
              >
                {showDetailFields ? (
                  <div
                    data-testid="calendar-event-editor-detail-layout"
                    data-layout-mode={useDesktopStage ? "desktop-staged" : "stacked"}
                    style={useDesktopStage
                      ? {
                          display: "flex",
                          flexDirection: "column",
                          gap: 16,
                          minWidth: 0,
                        }
                      : {
                          display: "flex",
                          flexDirection: "column",
                          gap: 14,
                        }}
                  >
                    {useDesktopStage ? (
                      <>
                        <div style={editorSurfaceStyle()}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 12,
                              flexWrap: "wrap",
                            }}
                          >
                            <div>
                              <FieldLabel>Schedule</FieldLabel>
                              <div style={sectionIntroStyle()}>
                                Set the event timing first, then add context below.
                              </div>
                            </div>
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
                                  if (nextAllDay && (openPicker === "startTime" || openPicker === "endTime")) {
                                    setOpenPicker(null);
                                  }
                                  updateField("allDay", nextAllDay);
                                }}
                                disabled={disabled}
                                style={{ accentColor: "#cba6da" }}
                              />
                              All day
                            </label>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div>
                              <FieldLabel>Start</FieldLabel>
                              <PickerFieldButton
                                anchorRef={startDateRef}
                                icon={CalendarDays}
                                value={formatDateLabel(draft.startDate)}
                                placeholder="Choose date"
                                dataTestId="calendar-event-start-date"
                                onClick={() => !disabled && setOpenPicker("startDate")}
                                disabled={disabled}
                                invalid={invalidDateRange}
                                trailingLabel=""
                              />
                            </div>
                            <div>
                              <FieldLabel>End</FieldLabel>
                              <PickerFieldButton
                                anchorRef={endDateRef}
                                icon={CalendarDays}
                                value={formatDateLabel(draft.endDate)}
                                placeholder="Choose date"
                                dataTestId="calendar-event-end-date"
                                onClick={() => !disabled && setOpenPicker("endDate")}
                                disabled={disabled}
                                invalid={invalidDateRange}
                                trailingLabel=""
                              />
                            </div>
                          </div>

                          {!draft.allDay ? (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                              <div>
                                <FieldLabel>Start time</FieldLabel>
                                <PickerFieldButton
                                  anchorRef={startTimeRef}
                                  icon={Clock3}
                                  value={formatTimeLabel(draft.startTime)}
                                  placeholder="Choose time"
                                  dataTestId="calendar-event-start-time"
                                  onClick={() => !disabled && setOpenPicker("startTime")}
                                  disabled={disabled}
                                  invalid={invalidTimeRange}
                                  trailingLabel=""
                                />
                              </div>
                              <div>
                                <FieldLabel>End time</FieldLabel>
                                <PickerFieldButton
                                  anchorRef={endTimeRef}
                                  icon={Clock3}
                                  value={formatTimeLabel(draft.endTime)}
                                  placeholder="Choose time"
                                  dataTestId="calendar-event-end-time"
                                  onClick={() => !disabled && setOpenPicker("endTime")}
                                  disabled={disabled}
                                  invalid={invalidTimeRange}
                                  trailingLabel=""
                                />
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 0.88fr) minmax(0, 1.12fr)",
                            gap: 16,
                            alignItems: "start",
                          }}
                        >
                          <div style={editorSurfaceStyle()}>
                            <div>
                              <FieldLabel>Location</FieldLabel>
                              <input
                                ref={locationRef}
                                data-testid="calendar-event-location"
                                type="text"
                                value={draft.location}
                                onFocus={() => {
                                  if (!disabled) setOpenPicker("location");
                                }}
                                onChange={(event) => {
                                  updateField("location", event.target.value);
                                  if (!disabled) setOpenPicker("location");
                                }}
                                onKeyDown={async (event) => {
                                  if (await handleLocationSuggestionKey(event)) return;
                                  event.stopPropagation();
                                }}
                                disabled={disabled}
                                placeholder="Search places or type location"
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
                                  Suggestions stay biased to your saved weather location.
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div style={editorSurfaceStyle()}>
                            <div>
                              <FieldLabel>Notes</FieldLabel>
                              <textarea
                                data-testid="calendar-event-description"
                                value={draft.description}
                                onKeyDown={(event) => event.stopPropagation()}
                                onChange={(event) => updateField("description", event.target.value)}
                                disabled={disabled}
                                rows={7}
                                placeholder="Optional"
                                style={{
                                  ...textFieldStyle(),
                                  resize: "vertical",
                                  minHeight: 182,
                                }}
                              />
                            </div>
                          </div>
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
                      </>
                    ) : (
                      <>
                        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
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
                                if (nextAllDay && (openPicker === "startTime" || openPicker === "endTime")) {
                                  setOpenPicker(null);
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
                                anchorRef={startDateRef}
                                icon={CalendarDays}
                                value={formatDateLabel(draft.startDate)}
                                placeholder="Choose date"
                                dataTestId="calendar-event-start-date"
                                onClick={() => !disabled && setOpenPicker("startDate")}
                                disabled={disabled}
                                invalid={invalidDateRange}
                                trailingLabel=""
                              />
                            </div>
                            <div>
                              <FieldLabel>End</FieldLabel>
                              <PickerFieldButton
                                anchorRef={endDateRef}
                                icon={CalendarDays}
                                value={formatDateLabel(draft.endDate)}
                                placeholder="Choose date"
                                dataTestId="calendar-event-end-date"
                                onClick={() => !disabled && setOpenPicker("endDate")}
                                disabled={disabled}
                                invalid={invalidDateRange}
                                trailingLabel=""
                              />
                            </div>
                          </div>

                          {!draft.allDay ? (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                              <div>
                                <FieldLabel>Start time</FieldLabel>
                                <PickerFieldButton
                                  anchorRef={startTimeRef}
                                  icon={Clock3}
                                  value={formatTimeLabel(draft.startTime)}
                                  placeholder="Choose time"
                                  dataTestId="calendar-event-start-time"
                                  onClick={() => !disabled && setOpenPicker("startTime")}
                                  disabled={disabled}
                                  invalid={invalidTimeRange}
                                  trailingLabel=""
                                />
                              </div>
                              <div>
                                <FieldLabel>End time</FieldLabel>
                                <PickerFieldButton
                                  anchorRef={endTimeRef}
                                  icon={Clock3}
                                  value={formatTimeLabel(draft.endTime)}
                                  placeholder="Choose time"
                                  dataTestId="calendar-event-end-time"
                                  onClick={() => !disabled && setOpenPicker("endTime")}
                                  disabled={disabled}
                                  invalid={invalidTimeRange}
                                  trailingLabel=""
                                />
                              </div>
                            </div>
                          ) : null}

                          <div>
                            <FieldLabel>Location</FieldLabel>
                            <input
                              ref={locationRef}
                              data-testid="calendar-event-location"
                              type="text"
                              value={draft.location}
                              onFocus={() => {
                                if (!disabled) setOpenPicker("location");
                              }}
                              onChange={(event) => {
                                updateField("location", event.target.value);
                                if (!disabled) setOpenPicker("location");
                              }}
                              onKeyDown={async (event) => {
                                if (await handleLocationSuggestionKey(event)) return;
                                event.stopPropagation();
                              }}
                              disabled={disabled}
                              placeholder="Search places or type location"
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
                                Suggestions stay biased to your saved weather location.
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
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
                        </div>
                      </>
                    )}
                  </div>
                ) : null}

                {!showDetailFields && isBatchMode ? (
                  <CalendarBatchReviewSection
                    batchDrafts={batchDrafts}
                    allDay={draft.allDay}
                    disabled={disabled}
                    onUpdateDraft={updateBatchDraft}
                    onRemoveDraft={removeBatchDraft}
                  />
                ) : null}

                {!showDetailFields && showRecurringBuilder ? (
                  <CalendarRecurrenceSection
                    recurrenceDraft={recurrenceDraft}
                    startDate={draft.startDate}
                    disabled={disabled}
                    onUpdateRecurrence={updateRecurrenceDraft}
                    onToggleWeekday={toggleRecurrenceWeekday}
                  />
                ) : null}

                <div style={{ marginTop: "auto", paddingTop: expandedDesktop ? 6 : 0 }}>
                  <CalendarEventEditorActionBar
                    editor={editor}
                    disabled={disabled}
                    saveDisabled={saveDisabled}
                    isBatchMode={isBatchMode}
                    isRecurringMode={isRecurringMode}
                  />
                </div>
              </div>
            </Motion.div>
          </AnimatePresence>
        </Motion.div>
      </div>

      <CalendarEventEditorPanels editor={editor} pickers={pickers} />
    </div>
  );
}
