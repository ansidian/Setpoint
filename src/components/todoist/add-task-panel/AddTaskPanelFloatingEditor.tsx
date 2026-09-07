import { useState } from "react";
import AnimatedHeight from "../../shared/AnimatedHeight";
import ExpandingTextarea from "../../shared/ExpandingTextarea";
import { CalendarClock, Trash2, X } from "lucide-react";
import { LabelPicker, PriorityIndicator } from "./controls";
import Dropdown from "../../shared/Dropdown";
import SearchableDropdown from "../../shared/SearchableDropdown";
import { buildContainerStyle, buildDropdownRowStyle, DRAG_HANDLE_STYLE } from "./styles";
import { FieldLabel, PickerFieldButton } from "../../calendar/events/CalendarEditorControls";
import { textFieldStyle } from "../../calendar/events/calendarEditorUtils";
import {
  TodoistActionFooter,
  TodoistDraftPreview,
  TodoistDescriptionLinks,
  TodoistDuePickerLayer,
  TodoistErrorNotice,
  TodoistSelectedLabelChips,
  TodoistTaskTextSection,
} from "./AddTaskPanelShared";
import TodoistReminderChips from "./TodoistReminderChips";
import type { CSSProperties } from "react";
import type useAddTaskPanelController from "./useAddTaskPanelController";

export default function AddTaskPanelFloatingEditor({
  active,
  state,
}: {
  active: boolean;
  state: ReturnType<typeof useAddTaskPanelController>;
}) {
  const [closeHover, setCloseHover] = useState(false);
  const {
    autocompleteType,
    addCustomTodoistReminder,
    addTodoistReminderPreset,
    canSubmit,
    cancelDelete,
    closeDuePicker,
    confirmDelete,
    confirmDiscard,
    confirmDeleteIntent,
    confirmDiscardChanges,
    cancelDiscard,
    cursorPos,
    deleting,
    deleteTask,
    description,
    descriptionVariant,
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
    handleInputBlur,
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
    supportingContext,
    titleError,
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
            <div id="todoist-editor-title" style={{ fontSize: 14, color: "var(--sp-accent)", fontWeight: 500 }}>
              {isEdit ? "Edit deadline" : "New deadline"}
            </div>
            {supportingContext && <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--color-text-faint)" }}>{supportingContext}</div>}
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
            handleInputBlur={handleInputBlur}
            handleKeyDown={handleKeyDown}
            input={input}
            inputRef={inputRef}
            labels={labels}
            projects={projects}
            recurrenceSummary={recurrenceSummary}
            titleError={titleError}
          />

          <div>
            <FieldLabel>Description</FieldLabel>
            <ExpandingTextarea
              value={description}
              aria-label="Task description"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
              expandable={descriptionVariant !== "email-context"}
              rows={descriptionVariant === "email-context" ? 7 : 1}
              style={{
                ...(textFieldStyle() as CSSProperties),
                resize: descriptionVariant === "email-context" || isMobile ? "none" : "vertical",
                minHeight: descriptionVariant === "email-context" ? 152 : undefined,
                maxHeight: descriptionVariant === "email-context" ? 240 : undefined,
                overflowY: descriptionVariant === "email-context" ? "auto" : undefined,
              }}
            />
            <TodoistDescriptionLinks description={description} />
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
            <div className="min-w-0 flex-1">
              <FieldLabel>Project</FieldLabel>
              <SearchableDropdown
                ariaLabel="Project"
                value={resolvedProject?.id}
                placeholder="Inbox"
                options={projects.map((project) => ({
                  id: project.id,
                  name: project.name,
                  content: <span className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: project.color || "var(--sp-subtext)" }} />
                    <span className="min-w-0 whitespace-normal break-words">{project.name}</span>
                  </span>,
                }))}
                onChange={(id) => {
                  const project = projects.find((entry) => entry.id === id);
                  if (!project) return;
                  setManualProject(project);
                  setOverrides((prev) => ({ ...prev, project: true }));
                }}
              />
            </div>
            <div className="min-w-0 w-full min-[640px]:w-24 min-[640px]:shrink-0">
              <FieldLabel>Priority</FieldLabel>
              <Dropdown
                ariaLabel="Priority"
                value={resolvedPriority === null ? "" : String(resolvedPriority)}
                options={priorityOptions.map((option) => ({
                  id: option.value === null ? "" : String(option.value),
                  name: option.label,
                  content: option.value ? <PriorityIndicator level={option.value} /> : "None",
                }))}
                onChange={(id) => {
                  const option = priorityOptions.find((entry) => (entry.value === null ? "" : String(entry.value)) === id);
                  if (!option) return;
                  setManualPriority(option.value);
                  setOverrides((prev) => ({ ...prev, priority: true }));
                }}
              />
            </div>
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
                      color: dueDisplay ? "var(--ea-accent)" : "var(--color-text-faint)",
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
            <AnimatedHeight>
              <div
                style={{
                  background: "rgba(205,214,244,0.04)",
                  border: resolvedLabels.length
                    ? "1px solid color-mix(in srgb, var(--sp-teal) 15%, transparent)"
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
                    labels={labels}
                    selected={resolvedLabels}
                    onChange={(updated) => {
                      setManualLabels(updated);
                      setOverrides((prev) => ({ ...prev, labels: true }));
                    }}
                  />
                )}
                {!resolvedLabels.length && !labels.length && (
                  <span style={{ color: "var(--color-text-faint)", fontSize: 12 }}>
                    None
                  </span>
                )}
              </div>
            </AnimatedHeight>
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
            confirmDiscard={confirmDiscard}
            confirmDeleteIntent={confirmDeleteIntent}
            confirmDiscardChanges={confirmDiscardChanges}
            cancelDiscard={cancelDiscard}
            deleteTask={deleteTask}
            deleting={deleting}
            showCancel={isEdit}
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
