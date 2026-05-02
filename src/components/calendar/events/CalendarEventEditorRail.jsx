import { useState } from "react";
import { AnimatePresence, motion as Motion } from "motion/react";
import CalendarBatchReviewSection from "./CalendarBatchReviewSection";
import CalendarRecurrenceSection from "./CalendarRecurrenceSection";
import CalendarRecurringScopePrompt from "./CalendarRecurringScopePrompt";
import CalendarEventEditorActionBar from "./CalendarEventEditorActionBar";
import CalendarEventEditorHeader from "./CalendarEventEditorHeader";
import CalendarEventLocationField from "./CalendarEventLocationField";
import CalendarEventNotesField from "./CalendarEventNotesField";
import CalendarEventScheduleFields from "./CalendarEventScheduleFields";
import CalendarEventEditorStatusMessages from "./CalendarEventEditorStatusMessages";
import DetailSummaryRow from "./CalendarEventDetailSummary";
import CalendarEventEditorPanels from "./CalendarEventEditorPanels";
import CalendarEventSourceField from "./CalendarEventSourceField";
import CalendarEventTitleAssistPanel from "./CalendarEventTitleAssistPanel";
import CalendarEventTitleField from "./CalendarEventTitleField";
import CalendarDraftPreviewPanel from "./CalendarDraftPreviewPanel";
import useCalendarEditorPickers from "./useCalendarEditorPickers";
import { EDITOR_ENTRANCE_TRANSITION, EDITOR_POSITION_TRANSITION } from "../detailRailMotion";
import {
  formatRecurrenceSummary,
} from "./calendarEditorUtils";

const editorModeTransition = EDITOR_ENTRANCE_TRANSITION;
const editorModePositionTransition = EDITOR_POSITION_TRANSITION;

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

export default function CalendarEventEditorRail({
  editor,
  expandedDesktop = false,
  ghostPreview = null,
  host = "rail",
}) {
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
  const floatingHost = host === "floating";
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
      role="region"
      aria-labelledby="calendar-event-editor-title"
      style={{
        padding: floatingHost ? 0 : expandedDesktop ? "18px 22px 20px" : "16px 20px",
        overflow: floatingHost ? "visible" : "auto",
        overscrollBehavior: "contain",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <CalendarEventEditorHeader
        isEditing={isEditing}
        isEditingRecurring={isEditingRecurring}
        recurringEditScope={recurringEditScope}
        isBatchMode={isBatchMode}
        isRecurringMode={isRecurringMode}
        batchDrafts={batchDrafts}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16, flex: 1, minHeight: 0 }}>
        <CalendarEventTitleField
          titleRef={titleRef}
          titleInput={titleInput}
          onTitleKeyDown={onTitleKeyDown}
          onTitleChange={onTitleChange}
          disabled={disabled}
          isEditing={isEditing}
          validationMessage={validationMessage}
        />

        <Motion.div
          layout="position"
          transition={editorModePositionTransition}
          style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0 }}
        >
          <AnimatePresence initial={false} mode="sync">
            <Motion.div
              key={editorModeKey}
              data-testid={`calendar-event-editor-mode-${editorModeKey}`}
              initial={{ opacity: 0, y: 20, scale: 0.982 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.99 }}
              transition={{
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

              <CalendarEventEditorStatusMessages
                error={error}
                errorCode={errorCode}
                validationMessage={validationMessage}
                reconnect={reconnect}
                showValidation={!(isEditingRecurring && !recurringEditScope)}
              />

              <CalendarDraftPreviewPanel ghostPreview={ghostPreview} />

              <CalendarEventTitleAssistPanel
                show={showTitleAssist}
                titleAssist={titleAssist}
                intentState={intentState}
                batchDrafts={batchDrafts}
              />

              <CalendarEventSourceField
                draft={draft}
                sourceRef={sourceRef}
                selectedSource={selectedSource}
                sourcesLoading={sourcesLoading}
                writableCalendars={writableCalendars}
                disabled={disabled}
                missingCalendar={missingCalendar}
                onOpen={() => setOpenPicker("source")}
              />

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
                          <CalendarEventScheduleFields
                            draft={draft}
                            disabled={disabled}
                            openPicker={openPicker}
                            setOpenPicker={setOpenPicker}
                            updateField={updateField}
                            startDateRef={startDateRef}
                            endDateRef={endDateRef}
                            startTimeRef={startTimeRef}
                            endTimeRef={endTimeRef}
                            invalidDateRange={invalidDateRange}
                            invalidTimeRange={invalidTimeRange}
                            desktop
                          />
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
                            <CalendarEventLocationField
                              locationRef={locationRef}
                              draft={draft}
                              disabled={disabled}
                              setOpenPicker={setOpenPicker}
                              updateField={updateField}
                              handleLocationSuggestionKey={handleLocationSuggestionKey}
                              locationSuggestionsError={locationSuggestionsError}
                            />
                          </div>

                          <div style={editorSurfaceStyle()}>
                            <CalendarEventNotesField
                              draft={draft}
                              disabled={disabled}
                              updateField={updateField}
                              rows={7}
                              minHeight={182}
                            />
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
                          <CalendarEventScheduleFields
                            draft={draft}
                            disabled={disabled}
                            openPicker={openPicker}
                            setOpenPicker={setOpenPicker}
                            updateField={updateField}
                            startDateRef={startDateRef}
                            endDateRef={endDateRef}
                            startTimeRef={startTimeRef}
                            endTimeRef={endTimeRef}
                            invalidDateRange={invalidDateRange}
                            invalidTimeRange={invalidTimeRange}
                          />
                          <CalendarEventLocationField
                            locationRef={locationRef}
                            draft={draft}
                            disabled={disabled}
                            setOpenPicker={setOpenPicker}
                            updateField={updateField}
                            handleLocationSuggestionKey={handleLocationSuggestionKey}
                            locationSuggestionsError={locationSuggestionsError}
                          />
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                          <CalendarEventNotesField
                            draft={draft}
                            disabled={disabled}
                            updateField={updateField}
                            rows={isCompactMode ? 3 : 5}
                            minHeight={isCompactMode ? 60 : 120}
                          />
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

                <div
                  style={{
                    marginTop: "auto",
                    paddingTop: expandedDesktop ? 6 : 0,
                    position: floatingHost ? "sticky" : "static",
                    bottom: floatingHost ? -12 : "auto",
                    zIndex: floatingHost ? 2 : "auto",
                    background: floatingHost
                      ? "linear-gradient(180deg, rgba(22,22,30,0), #16161e 18%)"
                      : "transparent",
                  }}
                >
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
