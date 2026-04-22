import { createPortal } from "react-dom";
import { CalendarClock, ChevronDown, Trash2, X } from "lucide-react";
import { Dropdown, LabelPicker, PriorityIndicator, RemoveLabelButton, TokenAutocomplete } from "./controls";
import TodoistDuePicker from "./TodoistDuePicker";
import {
  buildInlineContainerStyle,
  buildContainerStyle,
  buildDropdownRowStyle,
  buildTextareaStyle,
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
    deleteProgress,
    deleting,
    saveHover,
    setSaveHover,
    deleteHover,
    setDeleteHover,
    pos,
    isMobile,
    keyboardOffset,
    autocompleteType,
    cursorPos,
    panelRef,
    inputRef,
    dueTriggerRef,
    duePickerRef,
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
    handleKeyDown,
    priorityOptions,
    active,
    requestClose,
    cancelDelete,
    startDelete,
    isInline,
  } = controller;

  if (!isInline && !pos) return null;

  const content = (
    <div
      ref={panelRef}
      data-testid={isInline ? "todoist-inline-editor" : "todoist-floating-editor"}
      data-suspend-calendar-hotkeys="true"
      style={isInline
        ? buildInlineContainerStyle({ active })
        : buildContainerStyle({ isMobile, pos, active, keyboardOffset })}
    >
      {isMobile && !isInline && <div style={DRAG_HANDLE_STYLE} />}
      <div
        style={{
          padding: "12px 16px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "linear-gradient(135deg, rgba(203,166,218,0.06), transparent 70%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#cba6da",
          }}
        >
          {isEdit ? "Edit Todoist task" : "New Todoist task"}
        </div>
        <span style={{ flex: 1 }} />
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
            <X size={12} />
          </button>
        )}
      </div>

      <div style={{ padding: 16 }}>
        <div style={{ marginBottom: 10, position: "relative" }}>
          <div
            style={{
              color: "rgba(205,214,244,0.55)",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "2.2px",
              marginBottom: 5,
            }}
          >
            Task
          </div>
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
              width: "100%",
              background: "rgba(255,255,255,0.03)",
              border: input
                ? "1px solid rgba(203,166,218,0.4)"
                : "1px solid rgba(255,255,255,0.06)",
              borderRadius: 8,
              padding: "10px 12px",
              color: "#cdd6f4",
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
              boxShadow: input ? "0 0 0 1px rgba(203,166,218,0.15)" : "none",
              transition: "border-color 0.2s, box-shadow 0.2s",
              fontFamily: "inherit",
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
        </div>

        <div
          style={{
            color: "rgba(205,214,244,0.35)",
            fontSize: 10.5,
            marginBottom: 10,
            lineHeight: 1.5,
          }}
        >
          Supports dates · <span style={{ color: "#f38ba8" }}>!1-!4</span> priority · <span style={{ color: "#cba6da" }}>#project</span> · <span style={{ color: "#a6e3a1" }}>@label</span>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              color: "rgba(205,214,244,0.55)",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "2.2px",
              marginBottom: 5,
            }}
          >
            Description
          </div>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional"
            rows={2}
            style={buildTextareaStyle(isMobile)}
          />
        </div>

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

        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              color: "rgba(205,214,244,0.55)",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "2.2px",
              marginBottom: 5,
            }}
          >
            Due
          </div>
          <div style={{ position: "relative" }}>
            <button
              ref={dueTriggerRef}
              type="button"
              onClick={openDuePicker}
              aria-haspopup="dialog"
              aria-expanded={duePickerOpen}
              aria-label="Set due date"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                background:
                  dueDisplay
                    ? "color-mix(in srgb, var(--ea-accent) 8%, transparent)"
                    : "rgba(205,214,244,0.04)",
                border:
                  dueDisplay
                    ? "1px solid color-mix(in srgb, var(--ea-accent) 24%, transparent)"
                    : "1px solid rgba(205,214,244,0.08)",
                borderRadius: 8,
                padding: "9px 12px",
                color: dueDisplay ? "var(--ea-accent)" : "rgba(205,214,244,0.35)",
                fontSize: 12,
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.2s, background 0.2s, color 0.2s",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  minWidth: 0,
                  color: dueDisplay ? "var(--ea-accent)" : "rgba(205,214,244,0.35)",
                  fontSize: 12,
                  gap: 6,
                }}
              >
                <CalendarClock size={13} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {dueDisplay || "Pick a due date and time"}
                </span>
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: dueDisplay ? "var(--ea-accent)" : "rgba(205,214,244,0.42)",
                  flexShrink: 0,
                }}
              >
                {!dueDisplay && (
                  <span style={{ fontSize: 10.5, letterSpacing: 0.2 }}>
                    Or type one
                  </span>
                )}
                <ChevronDown size={13} />
              </span>
            </button>
          </div>
          <div
            style={{
              color: "rgba(205,214,244,0.35)",
              fontSize: 10.5,
              marginTop: 5,
              lineHeight: 1.45,
            }}
          >
            {dueDisplay
              ? "Manual picker selection overrides any date parsed from the task text."
              : "You can also type a natural-language date directly in the task text."}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              color: "rgba(205,214,244,0.55)",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "2.2px",
              marginBottom: 5,
            }}
          >
            Labels
          </div>
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

        {error && (
          <div
            style={{
              color: "#f38ba8",
              fontSize: 12,
              marginBottom: 8,
              padding: "6px 8px",
              background: "rgba(243,139,168,0.08)",
              borderRadius: 6,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 4,
            paddingTop: 12,
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isInline && (
              <button
                type="button"
                onClick={requestClose}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = "rgba(255,255,255,0.055)";
                  event.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
                  event.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = "rgba(255,255,255,0.025)";
                  event.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  event.currentTarget.style.transform = "translateY(0)";
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "7px 14px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  letterSpacing: 0.2,
                  cursor: "pointer",
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(205,214,244,0.74)",
                  transition: "background 0.2s, border-color 0.2s, transform 0.2s",
                }}
              >
                Cancel
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isEdit && (
              <button
                type="button"
                onPointerDown={startDelete}
                onPointerUp={(event) => {
                  cancelDelete();
                  setDeleteHover(event.currentTarget.matches(":hover"));
                }}
                onPointerEnter={() => setDeleteHover(true)}
                onPointerLeave={() => {
                  cancelDelete();
                  setDeleteHover(false);
                }}
                onPointerCancel={() => {
                  cancelDelete();
                  setDeleteHover(false);
                }}
                disabled={deleting || submitting}
                title="Hold to delete"
                style={{
                  position: "relative",
                  overflow: "hidden",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "7px 14px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  letterSpacing: 0.2,
                  cursor: deleting ? "wait" : "pointer",
                  background: deleteHover && !deleting ? "rgba(243,139,168,0.14)" : "rgba(243,139,168,0.08)",
                  border: `1px solid ${deleteHover && !deleting ? "rgba(243,139,168,0.48)" : "rgba(243,139,168,0.32)"}`,
                  color: "#f38ba8",
                  userSelect: "none",
                  boxShadow: deleteHover && !deleting ? "0 2px 8px rgba(243,139,168,0.22)" : "none",
                  transform: deleteHover && !deleting ? "translateY(-1px)" : "translateY(0)",
                  transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s, transform 0.2s",
                }}
              >
                {deleteProgress > 0 && (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${deleteProgress * 100}%`,
                      background: "linear-gradient(90deg, rgba(243,139,168,0.38), rgba(243,139,168,0.15))",
                      pointerEvents: "none",
                      transition: "width 40ms linear",
                    }}
                  />
                )}
                <Trash2 size={11} style={{ position: "relative" }} />
                <span style={{ position: "relative" }}>
                  {deleting ? "Deleting…" : "Delete"}
                </span>
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting || deleting}
              onMouseEnter={() => setSaveHover(true)}
              onMouseLeave={() => setSaveHover(false)}
              style={{
                background: canSubmit && !submitting && !deleting
                  ? (saveHover ? "rgba(166,227,161,0.22)" : "rgba(166,227,161,0.14)")
                  : "rgba(255,255,255,0.03)",
                borderRadius: 8,
                padding: "7px 14px",
                color: canSubmit && !submitting && !deleting ? "#a6e3a1" : "rgba(205,214,244,0.35)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 0.2,
                cursor: canSubmit && !submitting && !deleting ? "pointer" : "default",
                border: `1px solid ${canSubmit && !submitting && !deleting
                  ? (saveHover ? "rgba(166,227,161,0.5)" : "rgba(166,227,161,0.32)")
                  : "rgba(255,255,255,0.06)"}`,
                boxShadow: canSubmit && !submitting && !deleting && saveHover
                  ? "0 2px 8px rgba(166,227,161,0.22)"
                  : "none",
                transform: canSubmit && !submitting && !deleting && saveHover
                  ? "translateY(-1px)"
                  : "translateY(0)",
                transition: "all 0.2s",
                fontFamily: "inherit",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {submitting ? (isEdit ? "Saving…" : "Adding…") : (isEdit ? "Save" : "Add task")}
            </button>
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
      {content}
    </>,
    document.body,
  );
}
