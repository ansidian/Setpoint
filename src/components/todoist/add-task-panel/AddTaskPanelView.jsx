import { createPortal } from "react-dom";
import { CalendarClock, Trash2, X } from "lucide-react";
import { Dropdown, LabelPicker, PriorityIndicator, RemoveLabelButton, TokenAutocomplete } from "./controls";
import TodoistDuePicker from "./TodoistDuePicker";
import { FieldLabel, ActionButton, PickerFieldButton } from "../../calendar/events/CalendarEditorControls";
import { textFieldStyle } from "../../calendar/events/calendarEditorUtils";
import {
  buildInlineContainerStyle,
  buildContainerStyle,
  buildDropdownRowStyle,
  DRAG_HANDLE_STYLE,
} from "./styles";

export default function AddTaskPanelView({
  controller,
}) {
  const {
    isEdit,
    input,
    description,
    setDescription,
    projects,
    labels,
    setManualProject,
    setManualPriority,
    setManualLabels,
    setOverrides,
    pickerDueEpoch,
    submitting,
    error,
    deleting,
    confirmDelete,
    pos,
    isMobile,
    keyboardOffset,
    autocompleteType,
    cursorPos,
    panelRef,
    inputRef,
    dueTriggerRef,
    duePickerRef,
    recurrenceSummary,
    resolvedProject,
    resolvedPriority,
    resolvedLabels,
    dueDisplay,
    duePickerOpen,
    duePickerNow,
    openDuePicker,
    closeDuePicker,
    handleDueSelect,
    handleInputChange,
    handleAutocompleteSelect,
    canSubmit,
    handleSubmit,
    confirmDeleteIntent,
    deleteTask,
    handleKeyDown,
    priorityOptions,
    active,
    requestClose,
    cancelDelete,
    isInline,
    host,
  } = controller;

  if (!isInline && !pos) return null;

  const content = (
    <div
      ref={panelRef}
      data-testid={isInline ? "todoist-inline-editor" : "todoist-floating-editor"}
      data-suspend-calendar-hotkeys="true"
      style={isInline
        ? buildInlineContainerStyle({ active })
        : buildContainerStyle({ isMobile, pos, host, active, keyboardOffset })}
    >
      {isMobile && !isInline && <div style={DRAG_HANDLE_STYLE} />}
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
            <div style={{ fontSize: 14, color: "#cba6da", fontWeight: 500 }}>
              {isEdit ? "Edit Todoist task" : "New Todoist task"}
            </div>
          </div>
          {!isInline && (
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "rgba(205,214,244,0.5)",
                padding: 4,
                borderRadius: 4,
                display: "inline-flex",
                fontFamily: "inherit",
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {error && (
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
            {error}
          </div>
        )}

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
          <div style={{ position: "relative" }}>
            <FieldLabel>Task</FieldLabel>
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              enterKeyHint="done"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Buy groceries tomorrow ! #Shopping @errand"
              style={{
                ...textFieldStyle({ invalid: false }),
                boxShadow: input ? "0 0 0 1px rgba(203,166,218,0.15)" : "none",
              }}
            />
            {autocompleteType === "project" && (
              <TokenAutocomplete
                cursorPos={cursorPos}
                input={input}
                items={projects}
                type="project"
                onSelect={handleAutocompleteSelect}
              />
            )}
            {autocompleteType === "label" && (
              <TokenAutocomplete
                cursorPos={cursorPos}
                input={input}
                items={labels}
                type="label"
                onSelect={handleAutocompleteSelect}
              />
            )}
            {recurrenceSummary ? (
              <div
                data-testid="todoist-recurring-preview"
                style={{
                  marginTop: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  maxWidth: "100%",
                  padding: "5px 8px",
                  borderRadius: 999,
                  border: "1px solid rgba(137,180,250,0.18)",
                  background: "rgba(137,180,250,0.08)",
                  color: "#89b4fa",
                  fontSize: 11,
                  lineHeight: 1.3,
                }}
              >
                <CalendarClock size={11} />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Recurs {recurrenceSummary}
                </span>
              </div>
            ) : null}
          </div>

          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea
              value={description}
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
              {resolvedLabels.map((label) => (
                <span
                  key={label.id}
                  style={{
                    background: "rgba(166,218,203,0.1)",
                    border: "1px solid rgba(166,218,203,0.2)",
                    borderRadius: 4,
                    padding: "2px 8px",
                    color: "#a6dac0",
                    fontSize: 11,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {label.name}
                  <RemoveLabelButton
                    onRemove={() => {
                      const updated = resolvedLabels.filter((entry) => entry.id !== label.id);
                      setManualLabels(updated);
                      setOverrides((prev) => ({ ...prev, labels: true }));
                    }}
                  />
                </span>
              ))}
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
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            paddingTop: 4,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {confirmDelete ? (
              <>
                <ActionButton
                  dataTestId="todoist-delete-confirm"
                  danger
                  onClick={deleteTask}
                  disabled={deleting || submitting}
                >
                  {deleting ? "Deleting..." : "Confirm delete"}
                </ActionButton>
                <ActionButton subtle onClick={cancelDelete} disabled={deleting || submitting}>
                  Keep task
                </ActionButton>
              </>
            ) : (
              <>
                <ActionButton
                  onClick={handleSubmit}
                  disabled={!canSubmit || submitting || deleting}
                >
                  {submitting ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Save" : "Add task")}
                </ActionButton>
                {isInline && (
                  <ActionButton subtle onClick={requestClose} disabled={submitting || deleting}>
                    Cancel
                  </ActionButton>
                )}
              </>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            {isEdit && !confirmDelete ? (
              <ActionButton
                dataTestId="todoist-delete"
                danger
                onClick={confirmDeleteIntent}
                disabled={deleting || submitting}
              >
                <Trash2 size={11} />
                Delete
              </ActionButton>
            ) : null}
          </div>
        </div>
      </div>
      {duePickerOpen && (
        <TodoistDuePicker
          anchorRef={dueTriggerRef}
          panelRef={duePickerRef}
          nowTick={duePickerNow}
          initialEpoch={pickerDueEpoch}
          onSelect={handleDueSelect}
          onClose={closeDuePicker}
        />
      )}
    </div>
  );

  if (isInline) return content;

  return createPortal(
    <>
      {isMobile && (
        <div
          aria-hidden="true"
          onClick={requestClose}
          onTouchMove={(event) => event.preventDefault()}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 9998,
          }}
        />
      )}
      {!isMobile && host === "modal" && (
        <div
          aria-hidden="true"
          onClick={requestClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(2px)",
            zIndex: 9998,
            opacity: active ? 1 : 0,
            transition: "opacity 150ms ease",
          }}
        />
      )}
      {content}
    </>,
    document.body,
  );
}
