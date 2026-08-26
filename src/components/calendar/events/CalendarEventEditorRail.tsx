import { AnimatePresence, motion as Motion } from "motion/react";
import CalendarBatchReviewSection from "./CalendarBatchReviewSection";
import CalendarEventCompactCorrectionToolbar from "./CalendarEventCompactCorrectionToolbar";
import CalendarRecurringScopePrompt from "./CalendarRecurringScopePrompt";
import CalendarEventEditorActionBar from "./CalendarEventEditorActionBar";
import CalendarEventEditorHeader from "./CalendarEventEditorHeader";
import CalendarEventNotesField from "./CalendarEventNotesField";
import CalendarEventEditorStatusMessages from "./CalendarEventEditorStatusMessages";
import CalendarEventEditorPanels from "./CalendarEventEditorPanels";
import CalendarEventTitleAssistPanel from "./CalendarEventTitleAssistPanel";
import CalendarEventTitleField from "./CalendarEventTitleField";
import CalendarEventReminderChips from "./CalendarEventReminderChips";
import CalendarDraftPreviewPanel from "./CalendarDraftPreviewPanel";
import useCalendarEditorPickers from "./useCalendarEditorPickers";
import { EDITOR_ENTRANCE_TRANSITION } from "../detailRailMotion";
import type useCalendarEventEditor from "./useCalendarEventEditor";
import type { CalendarDraftGhostPreview } from "./CalendarDraftPreviewPanel";
import { projectTimeToLeaveEligibility } from "./calendarEventReminderModel";

interface CalendarEventEditorRailProps {
  editor: ReturnType<typeof useCalendarEventEditor>;
  ghostPreview?: CalendarDraftGhostPreview | null;
  host?: "rail" | "floating";
}

const editorModeTransition = {
  ...EDITOR_ENTRANCE_TRANSITION,
  ease: EDITOR_ENTRANCE_TRANSITION.ease as [number, number, number, number],
};

export default function CalendarEventEditorRail({
  editor,
  ghostPreview = null,
  host = "rail",
}: CalendarEventEditorRailProps) {
  const {
    draft,
    titleInputRef,
    titleInputKey,
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
    mutationPhase,
    isEditing,
    isEditingRecurring,
    updateField,
    updateBatchDraft,
    removeBatchDraft,
    exitBatchMode,
    selectRecurringEditScope,
    reconnect,
    eventReminders,
    eventReminderPresetStates,
    reminderError,
    customReminder,
    addEventReminderPreset,
    updateCustomReminder,
    addCustomEventReminder,
    removeEventReminder,
    timeToLeaveReminder,
    enableTimeToLeave,
    updateTimeToLeaveBuffer,
    removeTimeToLeave,
  } = editor;

  const pickers = useCalendarEditorPickers(editor);
  const {
    setOpenPicker,
    titleRef,
    sourceRef,
    locationRef,
    startDateRef,
    endDateRef,
    startTimeRef,
    endTimeRef,
    repeatRef,
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
  const isRecurringMode = intentState.mode === "recurring" || (!isBatchMode && !!recurrenceDraft);
  const showRecurringScopePrompt = isEditingRecurring;
  const floatingHost = host === "floating";
  const showBatchReview = isBatchMode && batchDrafts.length > 0;
  const editorModeKey = isEditing ? "edit" : "create";
  const timeToLeaveEligibility = projectTimeToLeaveEligibility({
    draft,
    contextAllowed: !isRecurringMode || (isEditingRecurring && recurringEditScope === "one"),
  });

  return (
    <div
      data-testid="calendar-event-editor-rail"
      data-editor-layout="slim-icon"
      data-calendar-local-scroll="true"
      role="region"
      aria-labelledby="calendar-event-editor-title"
      onClick={(event) => {
        if (!pickers.openPicker) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-calendar-popover-trigger='true']")) return;
        if (target?.closest("[data-calendar-popover-panel='true']")) return;
        setOpenPicker(null);
      }}
      style={{
        padding: 0,
        overflow: "hidden",
        overscrollBehavior: "contain",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        data-testid="calendar-event-editor-scroll-region"
        data-calendar-local-scroll="true"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          scrollbarGutter: "stable",
          padding: floatingHost ? 0 : "16px 20px 0",
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

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16, minHeight: 0 }}>
          <CalendarEventTitleField
            titleRef={titleRef}
            titleInputRef={titleInputRef}
            titleInputKey={titleInputKey}
            onTitleKeyDown={onTitleKeyDown}
            onTitleChange={onTitleChange}
            disabled={disabled}
            isEditing={isEditing}
            validationMessage={validationMessage}
          />
          <CalendarEventNotesField
            draft={draft}
            disabled={disabled}
            updateField={updateField}
            compact
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
            <AnimatePresence initial={false} mode="sync">
              <Motion.div
                key={editorModeKey}
                data-testid={`calendar-event-editor-mode-${editorModeKey}`}
                data-calendar-intent-mode={editorModeKey === "create" ? intentState.mode : "edit"}
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
                  minHeight: 0,
                  paddingBottom: 16,
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
                mutationPhase={mutationPhase}
              />

              <CalendarDraftPreviewPanel
                ghostPreview={ghostPreview}
                draft={draft}
                selectedSource={selectedSource}
                recurrenceDraft={recurrenceDraft}
                isRecurringEvent={isEditingRecurring}
                showDraftFallback={isEditing}
              />

              <CalendarEventTitleAssistPanel
                show={showTitleAssist}
                titleAssist={titleAssist}
              />

              <CalendarEventCompactCorrectionToolbar
                draft={draft}
                disabled={disabled}
                selectedSource={selectedSource}
                sourcesLoading={sourcesLoading}
                writableCalendars={writableCalendars}
                missingCalendar={missingCalendar}
                invalidDateRange={invalidDateRange}
                invalidTimeRange={invalidTimeRange}
                isBatchMode={isBatchMode}
                batchDrafts={batchDrafts}
                recurrenceDraft={recurrenceDraft}
                onExitBatchMode={exitBatchMode}
                openPicker={pickers.openPicker}
                setOpenPicker={setOpenPicker}
                updateField={updateField}
                startDateRef={startDateRef}
                endDateRef={endDateRef}
                startTimeRef={startTimeRef}
                endTimeRef={endTimeRef}
                sourceRef={sourceRef}
                locationRef={locationRef}
                repeatRef={repeatRef}
                handleLocationSuggestionKey={handleLocationSuggestionKey}
              />

              {!isBatchMode ? (
                <CalendarEventReminderChips
                  reminders={eventReminders}
                  presetStates={eventReminderPresetStates}
                  reminderError={reminderError}
                  customReminder={customReminder}
                  disabled={disabled}
                  onAddPreset={addEventReminderPreset}
                  onUpdateCustomReminder={updateCustomReminder}
                  onAddCustom={addCustomEventReminder}
                  onRemoveReminder={removeEventReminder}
                  timeToLeaveReminder={timeToLeaveReminder}
                  timeToLeaveEligible={timeToLeaveEligibility.eligible}
                  onEnableTimeToLeave={enableTimeToLeave}
                  onUpdateTimeToLeaveBuffer={updateTimeToLeaveBuffer}
                  onRemoveTimeToLeave={removeTimeToLeave}
                />
              ) : null}

                {showBatchReview ? (
                  <CalendarBatchReviewSection
                    batchDrafts={batchDrafts}
                    allDay={draft.allDay}
                    disabled={disabled}
                    onUpdateDraft={updateBatchDraft}
                    onRemoveDraft={removeBatchDraft}
                  />
                ) : null}
              </Motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div
        data-testid="calendar-event-editor-action-dock"
        style={{
          position: "relative",
          zIndex: 2,
          flexShrink: 0,
          padding: floatingHost ? "0 0 2px" : "0 20px 16px",
          background: "var(--sp-panel)",
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

      <CalendarEventEditorPanels editor={editor} pickers={pickers} />
    </div>
  );
}
