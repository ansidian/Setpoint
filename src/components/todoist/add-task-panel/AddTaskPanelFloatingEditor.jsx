import { useState } from "react";
import { CalendarClock, Trash2, X } from "lucide-react";
import { Dropdown, LabelPicker, PriorityIndicator } from "./controls";
import { buildContainerStyle, buildDropdownRowStyle, DRAG_HANDLE_STYLE } from "./styles";
import { FieldLabel, PickerFieldButton } from "../../calendar/events/CalendarEditorControls";
import { textFieldStyle } from "../../calendar/events/calendarEditorUtils";
import {
  TodoistActionFooter,
  TodoistDraftPreview,
  TodoistDuePickerLayer,
  TodoistErrorNotice,
  TodoistSelectedLabelChips,
  TodoistTaskTextSection,
} from "./AddTaskPanelShared.jsx";
import TodoistReminderChips from "./TodoistReminderChips.jsx";

export default function AddTaskPanelFloatingEditor({ active, state }) {
  const [closeHover, setCloseHover] = useState(false);
  const {
    autocompleteType,
    addCustomTodoistReminder,
    addTodoistReminderPreset,
    canSubmit,
    cancelDelete,
    closeDuePicker,
    confirmDelete,
    confirmDeleteIntent,
    cursorPos,
    deleting,
    deleteTask,
    description,
    draftPreview,
    dueDisplay,
    duePickerNow,
    duePickerOpen,
    duePickerRef,
    dueTriggerRef,
    error,
    handleAutocompleteSelect,
    handleDueSelect,
    handleInputChange,
    handleKeyDown,
    handleSubmit,
    hasReminderAnchor,
    host,
    input,
    inputRef,
    isEdit,
    isMobile,
    keyboardOffset,
    labels,
    openDuePicker,
    panelRef,
    pickerDueEpoch,
    pos,
    priorityOptions,
    projects,
    recurrenceSummary,
    reminderError,
    removeTodoistReminder,
    requestClose,
    resolvedLabels,
    resolvedPriority,
    resolvedProject,
    setDescription,
    setManualLabels,
    setManualPriority,
    setManualProject,
    setOverrides,
    submitting,
    todoistReminders,
    todoistReminderPresetStates,
    updateCustomReminder,
    customReminder,
  } = state;

  return (
    <div
      ref={panelRef}
      data-testid="todoist-floating-editor"
      data-suspend-calendar-hotkeys="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="todoist-editor-title"
      style={buildContainerStyle({ isMobile, pos, host, active, keyboardOffset })}
    >
      {isMobile && <div style={DRAG_HANDLE_STYLE} />}
      <div
        style={{
          padding: host === "modal" ? "20px 24px 24px" : "16px 20px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div id="todoist-editor-title" style={{ fontSize: 14, color: "#cba6da", fontWeight: 500 }}>
              {isEdit ? "Edit Todoist task" : "New Todoist task"}
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            onMouseEnter={() => setCloseHover(true)}
            onMouseLeave={() => setCloseHover(false)}
            style={{
              background: closeHover ? "rgba(255,255,255,0.06)" : "transparent",
              border: "1px solid transparent",
              cursor: "pointer",
              color: closeHover ? "rgba(205,214,244,0.78)" : "rgba(205,214,244,0.5)",
              padding: 4,
              borderRadius: 4,
              display: "inline-flex",
              fontFamily: "inherit",
              transform: closeHover ? "translateY(-1px)" : "translateY(0)",
              transition: "transform 140ms, background 140ms, color 140ms",
            }}
          >
            <X size={16} />
          </button>
        </div>

        <TodoistErrorNotice error={error} />
        <TodoistDraftPreview draftPreview={draftPreview} />

        <div
          style={{
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.05)",
            background: "rgba(255,255,255,0.02)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minWidth: 0,
          }}
        >
          <TodoistTaskTextSection
            autocompleteType={autocompleteType}
            cursorPos={cursorPos}
            handleAutocompleteSelect={handleAutocompleteSelect}
            handleInputChange={handleInputChange}
            handleKeyDown={handleKeyDown}
            input={input}
            inputRef={inputRef}
            labels={labels}
            projects={projects}
            recurrenceSummary={recurrenceSummary}
          />

          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea
              value={description}
              aria-label="Task description"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
              rows={2}
              style={{
                ...textFieldStyle(),
                resize: isMobile ? "none" : "vertical",
                minHeight: 40,
              }}
            />
          </div>
        </div>

        <div
          style={{
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.05)",
            background: "rgba(255,255,255,0.02)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minWidth: 0,
          }}
        >
          <div style={buildDropdownRowStyle(isMobile)}>
            <Dropdown
              label="Project"
              value={resolvedProject}
              color={resolvedProject ? "#cba6da" : null}
              options={projects}
              onChange={(opt) => {
                setManualProject(opt);
                setOverrides((prev) => ({ ...prev, project: true }));
              }}
              renderValue={(val) => val?.name || "Inbox"}
              renderOption={(opt) => (
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: opt.color || "rgba(205,214,244,0.3)",
                    }}
                  />
                  {opt.name}
                </span>
              )}
            />
            <Dropdown
              label="Priority"
              value={resolvedPriority}
              color={
                resolvedPriority && resolvedPriority <= 2
                  ? "#f38ba8"
                  : resolvedPriority === 3
                    ? "#89b4fa"
                    : null
              }
              options={priorityOptions}
              onChange={(opt) => {
                setManualPriority(opt.value);
                setOverrides((prev) => ({ ...prev, priority: true }));
              }}
              renderValue={(val) => (val ? <PriorityIndicator level={val} /> : "None")}
              renderOption={(opt) => (opt.value ? <PriorityIndicator level={opt.value} /> : "None")}
            />
          </div>

          <div>
            <FieldLabel>Due</FieldLabel>
            <div style={{ position: "relative" }}>
              <PickerFieldButton
                anchorRef={dueTriggerRef}
                ariaLabel="Set due date"
                icon={CalendarClock}
                value={
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      color: dueDisplay ? "var(--ea-accent)" : "rgba(205,214,244,0.35)",
                    }}
                  >
                    {dueDisplay || "Pick a due date and time"}
                  </span>
                }
                onClick={openDuePicker}
                invalid={false}
                leading={null}
                trailingLabel={null}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Labels</FieldLabel>
            <div
              style={{
                background: "rgba(205,214,244,0.04)",
                border: resolvedLabels.length
                  ? "1px solid rgba(166,218,203,0.15)"
                  : "1px solid rgba(205,214,244,0.08)",
                borderRadius: 8,
                padding: "6px 12px",
                minHeight: 32,
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 4,
              }}
            >
              <TodoistSelectedLabelChips
                borderRadius={4}
                fontSize={11}
                padding="2px 8px"
                resolvedLabels={resolvedLabels}
                setManualLabels={setManualLabels}
                setOverrides={setOverrides}
              />
              {labels.length > 0 && (
                <LabelPicker
                  available={labels.filter((label) => !resolvedLabels.find((entry) => entry.id === label.id))}
                  onAdd={(label) => {
                    const updated = [...resolvedLabels, label];
                    setManualLabels(updated);
                    setOverrides((prev) => ({ ...prev, labels: true }));
                  }}
                />
              )}
              {!resolvedLabels.length && !labels.length && (
                <span style={{ color: "rgba(205,214,244,0.3)", fontSize: 12 }}>
                  None
                </span>
              )}
            </div>
          </div>

          <TodoistReminderChips
            reminders={todoistReminders}
            reminderError={reminderError}
            customReminder={customReminder}
            disabled={submitting || deleting}
            hasAnchor={hasReminderAnchor}
            presetStates={todoistReminderPresetStates}
            onAddPreset={addTodoistReminderPreset}
            onUpdateCustomReminder={updateCustomReminder}
            onAddCustom={addCustomTodoistReminder}
            onRemoveReminder={removeTodoistReminder}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, paddingTop: 4 }}>
          <TodoistActionFooter
            canSubmit={canSubmit}
            cancelDelete={cancelDelete}
            confirmDelete={confirmDelete}
            confirmDeleteIntent={confirmDeleteIntent}
            deleteTask={deleteTask}
            deleting={deleting}
            handleSubmit={handleSubmit}
            isEdit={isEdit}
            requestClose={requestClose}
            showDeleteIcon={Trash2}
            submitting={submitting}
          />
        </div>
      </div>
      <TodoistDuePickerLayer
        closeDuePicker={closeDuePicker}
        duePickerOpen={duePickerOpen}
        duePickerNow={duePickerNow}
        duePickerRef={duePickerRef}
        dueTriggerRef={dueTriggerRef}
        handleDueSelect={handleDueSelect}
        pickerDueEpoch={pickerDueEpoch}
      />
    </div>
  );
}
