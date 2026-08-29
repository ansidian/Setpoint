import { useState } from "react";
import type { ComponentProps, CSSProperties, Dispatch, MouseEventHandler, ReactNode, SetStateAction } from "react";
import { PriorityIndicator } from "./controls";
import { buildInlineContainerStyle } from "./styles";
import { textFieldStyle } from "../../calendar/events/calendarEditorUtils";
import {
  TodoistActionFooter,
  TodoistDescriptionLinks,
  TodoistDuePickerLayer,
  TodoistErrorNotice,
  TodoistTaskTextSection,
} from "./AddTaskPanelShared";
import TodoistReminderChips from "./TodoistReminderChips";
import TodoistDeadlineFactSheet from "./TodoistDeadlineFactSheet";
import type { TodoistLabel, TodoistPriority, TodoistProject } from "../../../../shared/types/tasks";
import type { AddTaskOverrides, CompactPanel } from "./types";
import type useAddTaskPanelController from "./useAddTaskPanelController";

function CompactOptionPanel({ children }: { children: ReactNode }) {
  return (
    <div
      role="listbox"
      style={{
        display: "grid",
        gap: 6,
        padding: 8,
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.035)",
      }}
    >
      {children}
    </div>
  );
}

function CompactOption({
  children,
  onClick,
  active = false,
  color = null,
}: {
  children: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  active?: boolean;
  color?: string | null;
}) {
  return (
    <button
      type="button"
      role="option"
      className="calendar-editor-inline-option"
      data-calendar-focus-ring="true"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        minWidth: 0,
        minHeight: 30,
        borderRadius: 8,
        border: active
          ? `1px solid color-mix(in srgb, ${color || "var(--sp-accent)"} 34%, transparent)`
          : "1px solid rgba(255,255,255,0.06)",
        background: active
          ? `color-mix(in srgb, ${color || "var(--sp-accent)"} 12%, transparent)`
          : "rgba(255,255,255,0.025)",
        color: color || "var(--sp-text)",
        padding: "6px 9px",
        fontSize: 11.5,
        fontWeight: 600,
        textAlign: "left",
        fontFamily: "inherit",
        cursor: "pointer",
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </button>
  );
}

function CompactDescriptionField({
  description,
  setDescription,
  isMobile,
  emailContext = false,
}: {
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  isMobile: boolean;
  emailContext?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const expanded = emailContext || focused || !!description.trim();

  return (
    <div>
      <textarea
        value={description}
        data-compact-notes="true"
        aria-label="Task description"
        onChange={(event) => setDescription(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Notes"
        rows={emailContext ? 7 : expanded ? 3 : 1}
        style={{
          ...(textFieldStyle() as CSSProperties),
          resize: emailContext || isMobile ? "none" : "vertical",
          minHeight: emailContext ? 152 : expanded ? 72 : 38,
          maxHeight: emailContext ? 240 : undefined,
          overflowY: emailContext ? "auto" : undefined,
          padding: "8px 10px",
          transition: "min-height 160ms, background 140ms, border-color 140ms",
        }}
      />
      <TodoistDescriptionLinks description={description} />
    </div>
  );
}

function CompactDetailPanel({
  labels,
  openCompactPanel,
  priorityOptions,
  projects,
  resolvedLabels,
  resolvedPriority,
  resolvedProject,
  setManualLabels,
  setManualPriority,
  setManualProject,
  setOpenCompactPanel,
  setOverrides,
}: {
  labels: TodoistLabel[];
  openCompactPanel: CompactPanel;
  priorityOptions: Array<{ value: TodoistPriority; label: string }>;
  projects: TodoistProject[];
  resolvedLabels: TodoistLabel[];
  resolvedPriority: TodoistPriority;
  resolvedProject: TodoistProject | null;
  setManualLabels: Dispatch<SetStateAction<TodoistLabel[] | null>>;
  setManualPriority: Dispatch<SetStateAction<TodoistPriority>>;
  setManualProject: Dispatch<SetStateAction<TodoistProject | null>>;
  setOpenCompactPanel: Dispatch<SetStateAction<CompactPanel>>;
  setOverrides: Dispatch<SetStateAction<AddTaskOverrides>>;
}) {
  if (openCompactPanel === "project") {
    return (
      <CompactOptionPanel>
        {projects.map((project) => (
          <CompactOption
            key={project.id}
            active={resolvedProject?.id === project.id}
            color={project.color || "var(--sp-accent)"}
            onClick={() => {
              setManualProject(project);
              setOverrides((prev) => ({ ...prev, project: true }));
              setOpenCompactPanel(null);
            }}
          >
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: project.color || "rgba(205,214,244,0.3)", flexShrink: 0 }} />
            {project.name}
          </CompactOption>
        ))}
      </CompactOptionPanel>
    );
  }

  if (openCompactPanel === "priority") {
    return (
      <CompactOptionPanel>
        {priorityOptions.map((option) => (
          <CompactOption
            key={option.value || "none"}
            active={resolvedPriority === option.value}
            color={option.value && option.value <= 2 ? "var(--sp-rose)" : option.value === 3 ? "var(--sp-blue)" : null}
            onClick={() => {
              setManualPriority(option.value);
              setOverrides((prev) => ({ ...prev, priority: true }));
              setOpenCompactPanel(null);
            }}
          >
            {option.value ? (
              <>
                <PriorityIndicator level={option.value} />
                <span style={{ color: "rgba(205,214,244,0.78)" }}>
                  {option.label.replace(" — ", " ").replace(/^P\d\s*/, "")}
                </span>
              </>
            ) : "None"}
          </CompactOption>
        ))}
      </CompactOptionPanel>
    );
  }

  if (openCompactPanel !== "labels") return null;
  return (
    <CompactOptionPanel>
      {labels.length ? labels.map((label) => {
        const activeLabel = resolvedLabels.some((entry) => entry.id === label.id || entry.name === label.name);
        return (
          <CompactOption
            key={label.id}
            active={activeLabel}
            color="var(--sp-teal)"
            onClick={() => {
              const updated = activeLabel
                ? resolvedLabels.filter((entry) => entry.id !== label.id && entry.name !== label.name)
                : [...resolvedLabels, label];
              setManualLabels(updated);
              setOverrides((prev) => ({ ...prev, labels: true }));
            }}
          >
            {label.name}
          </CompactOption>
        );
      }) : (
        <div style={{ color: "var(--color-text-faint)", fontSize: 11.5, padding: "6px 9px" }}>
          No labels available
        </div>
      )}
    </CompactOptionPanel>
  );
}

function CompactActions(props: Omit<ComponentProps<typeof TodoistActionFooter>, "showCancel" | "showDeleteIcon">) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        marginTop: 18,
        paddingTop: 14,
        borderTop: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <TodoistActionFooter {...props} showCancel />
    </div>
  );
}

export default function AddTaskPanelInlineEditor({
  active,
  openCompactPanel,
  setOpenCompactPanel,
  state,
}: {
  active: boolean;
  openCompactPanel: CompactPanel;
  setOpenCompactPanel: Dispatch<SetStateAction<CompactPanel>>;
  state: ReturnType<typeof useAddTaskPanelController>;
}) {
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
    customReminder,
    deleting,
    deleteTask,
    description,
    descriptionVariant,
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
    input,
    inputRef,
    isEdit,
    isMobile,
    labels,
    panelRef,
    pickerDueEpoch,
    priorityOptions,
    projects,
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
    supportingContext,
    todoistReminders,
    todoistReminderPresetStates,
    titleError,
    updateCustomReminder,
  } = state;

  return (
    <div
      ref={panelRef}
      data-testid="todoist-inline-editor"
      data-editor-layout="slim-icon"
      data-calendar-local-scroll="true"
      data-suspend-calendar-hotkeys="true"
      role="region"
      aria-labelledby="todoist-editor-title"
      style={buildInlineContainerStyle({ active })}
    >
      <div style={{ padding: 0, display: "flex", flexDirection: "column", gap: 0, minHeight: 0, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div id="todoist-editor-title" style={{ fontSize: 14, color: "var(--sp-accent)", fontWeight: 500 }}>
              {isEdit ? "Edit deadline" : "New deadline"}
            </div>
            {supportingContext && <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--color-text-faint)" }}>{supportingContext}</div>}
            <div style={{ marginTop: 3, fontSize: 11, color: "var(--color-text-faint)", lineHeight: 1.45 }}>
              Deadline text can carry dates, priority, projects, and labels.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16, flex: 1, minHeight: 0 }}>
          <TodoistErrorNotice error={error} compact />
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
            recurrenceSummary={null}
            titleError={titleError}
          />
          <TodoistDeadlineFactSheet
            openCompactPanel={openCompactPanel}
            setOpenCompactPanel={setOpenCompactPanel}
            state={state}
          />

          <CompactDetailPanel
            labels={labels}
            openCompactPanel={openCompactPanel}
            priorityOptions={priorityOptions}
            projects={projects}
            resolvedLabels={resolvedLabels}
            resolvedPriority={resolvedPriority}
            resolvedProject={resolvedProject}
            setManualLabels={setManualLabels}
            setManualPriority={setManualPriority}
            setManualProject={setManualProject}
            setOpenCompactPanel={setOpenCompactPanel}
            setOverrides={setOverrides}
          />

          <CompactDescriptionField description={description} setDescription={setDescription} isMobile={isMobile} emailContext={descriptionVariant === "email-context"} />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <TodoistReminderChips
              compact
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

          <div style={{ marginTop: "auto", paddingTop: 6, position: "sticky", bottom: -12, zIndex: 2, background: "linear-gradient(180deg, rgba(22,22,30,0), var(--sp-panel) 18%)" }}>
            <CompactActions
              canSubmit={canSubmit}
              cancelDelete={cancelDelete}
              confirmDelete={confirmDelete}
              confirmDiscard={confirmDiscard}
              confirmDeleteIntent={confirmDeleteIntent}
              confirmDiscardChanges={confirmDiscardChanges}
              cancelDiscard={cancelDiscard}
              deleteTask={deleteTask}
              deleting={deleting}
              handleSubmit={handleSubmit}
              isEdit={isEdit}
              requestClose={requestClose}
              submitting={submitting}
            />
          </div>
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
