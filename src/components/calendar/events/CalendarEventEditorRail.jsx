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
import CalendarDraftPreviewPanel from "./CalendarDraftPreviewPanel";
import useCalendarEditorPickers from "./useCalendarEditorPickers";
import { EDITOR_ENTRANCE_TRANSITION } from "../detailRailMotion";

const editorModeTransition = EDITOR_ENTRANCE_TRANSITION;

export default function CalendarEventEditorRail({
  editor,
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
    updateField,
    updateBatchDraft,
    removeBatchDraft,
    exitBatchMode,
    selectRecurringEditScope,
    reconnect,
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

  return (
    <div
      data-testid="calendar-event-editor-rail"
      data-editor-layout="slim-icon"
      data-calendar-local-scroll="true"
      role="region"
      aria-labelledby="calendar-event-editor-title"
      onClick={(event) => {
        if (!pickers.openPicker) return;
        if (event.target?.closest?.("[data-calendar-popover-trigger='true']")) return;
        if (event.target?.closest?.("[data-calendar-popover-panel='true']")) return;
        setOpenPicker(null);
      }}
      style={{
        padding: floatingHost ? 0 : "16px 20px",
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
        <CalendarEventNotesField
          draft={draft}
          disabled={disabled}
          updateField={updateField}
          compact
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0 }}>
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

              <CalendarDraftPreviewPanel
                ghostPreview={ghostPreview}
                draft={draft}
                selectedSource={selectedSource}
                recurrenceDraft={recurrenceDraft}
              />

              <CalendarEventTitleAssistPanel
                show={showTitleAssist}
                titleAssist={titleAssist}
                intentState={intentState}
                batchDrafts={batchDrafts}
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

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  flex: 1,
                  minHeight: 0,
                }}
              >
                {showBatchReview ? (
                  <CalendarBatchReviewSection
                    batchDrafts={batchDrafts}
                    allDay={draft.allDay}
                    disabled={disabled}
                    onUpdateDraft={updateBatchDraft}
                    onRemoveDraft={removeBatchDraft}
                  />
                ) : null}

                <div
                  style={{
                    marginTop: "auto",
                    paddingTop: floatingHost ? 6 : 0,
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
        </div>
      </div>

      <CalendarEventEditorPanels editor={editor} pickers={pickers} />
    </div>
  );
}
