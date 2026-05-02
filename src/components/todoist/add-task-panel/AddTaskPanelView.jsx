import { createPortal } from "react-dom";
import { createElement, useState } from "react";
import { CalendarClock, Flag, Folder, Tags, Trash2, X } from "lucide-react";
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

function CompactIconButton({
  anchorRef,
  icon: Icon,
  label,
  active = false,
  danger = false,
  disabled = false,
  dataTestId,
  onClick,
  children = null,
  width = 34,
}) {
  const [hover, setHover] = useState(false);
  const fallbackIcon = Icon ? createElement(Icon, { size: 15, "aria-hidden": true }) : null;
  const activeColor = danger ? "#f38ba8" : "var(--ea-accent)";
  const border = active
    ? `color-mix(in srgb, ${activeColor} 42%, transparent)`
    : hover && !disabled
      ? "rgba(255,255,255,0.16)"
      : "rgba(255,255,255,0.08)";
  const background = active
    ? `color-mix(in srgb, ${activeColor} 15%, transparent)`
    : hover && !disabled
      ? "rgba(255,255,255,0.06)"
      : "rgba(255,255,255,0.035)";
  const foreground = active ? activeColor : "rgba(205,214,244,0.58)";

  return (
    <button
      ref={anchorRef}
      type="button"
      data-testid={dataTestId}
      data-calendar-popover-trigger="true"
      data-calendar-focus-ring="true"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width,
        height: 34,
        borderRadius: 8,
        border: `1px solid ${border}`,
        background,
        color: disabled ? "rgba(205,214,244,0.34)" : foreground,
        display: "inline-grid",
        placeItems: "center",
        padding: 0,
        flex: "0 0 auto",
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.66 : 1,
        transform: hover && !disabled ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 140ms, background 140ms, border-color 140ms, color 140ms, opacity 140ms",
      }}
    >
      {children || fallbackIcon}
    </button>
  );
}

function CompactPriorityBadge({ level }) {
  const colors = {
    1: "#f38ba8",
    2: "#f9e2af",
    3: "#89b4fa",
    4: "#a6adc8",
  };
  const color = colors[level] || colors[4];
  const litCount = 5 - level;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        width: "100%",
        minWidth: 0,
        color,
      }}
    >
      <span aria-hidden style={{ display: "inline-flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
        {[1, 2, 3, 4].map((index) => (
          <span
            key={index}
            style={{
              width: 3,
              height: 10,
              borderRadius: 2,
              background: color,
              opacity: index <= litCount ? 1 : 0.22,
            }}
          />
        ))}
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 750, lineHeight: 1, whiteSpace: "nowrap" }}>
        P{level}
      </span>
    </span>
  );
}

function CompactOptionPanel({ children }) {
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

function CompactOption({ children, onClick, active = false, color = null }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        minHeight: 30,
        borderRadius: 8,
        border: active
          ? `1px solid color-mix(in srgb, ${color || "var(--ea-accent)"} 34%, transparent)`
          : "1px solid rgba(255,255,255,0.06)",
        background: active
          ? `color-mix(in srgb, ${color || "var(--ea-accent)"} 12%, transparent)`
          : "rgba(255,255,255,0.025)",
        color: color || "#cdd6f4",
        padding: "6px 9px",
        fontSize: 11.5,
        fontWeight: 600,
        textAlign: "left",
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function CompactDescriptionField({ description, setDescription, isMobile }) {
  const [focused, setFocused] = useState(false);
  const expanded = focused || !!description.trim();

  return (
    <textarea
      value={description}
      data-compact-notes="true"
      aria-label="Task description"
      onChange={(event) => setDescription(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder="Notes"
      rows={expanded ? 3 : 1}
      style={{
        ...textFieldStyle(),
        resize: isMobile ? "none" : "vertical",
        minHeight: expanded ? 72 : 38,
        padding: "8px 10px",
        transition: "min-height 160ms, background 140ms, border-color 140ms",
      }}
    />
  );
}

function CompactMetadataChip({ children, color = "rgba(205,214,244,0.62)" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        maxWidth: "100%",
        minWidth: 0,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.025)",
        color,
        padding: "3px 7px",
        fontSize: 10.5,
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {children}
    </span>
  );
}

function formatFriendlyPreviewTime(value) {
  const text = String(value || "").trim();
  if (!text) return "End of day";
  return text.replace(/:00\s+(AM|PM)$/i, " $1");
}

function formatFriendlyDraftPreview(draftPreview) {
  if (!draftPreview?.dueDate) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(draftPreview.dueDate));
  const dateLabel = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : draftPreview.dueDate;
  return `${dateLabel} · ${formatFriendlyPreviewTime(draftPreview.dueTime)}`;
}

export default function AddTaskPanelView({
  controller,
}) {
  const {
    isEdit,
    editingTask,
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
    draftPreview,
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
  const [openCompactPanel, setOpenCompactPanel] = useState(null);

  if (!isInline && !pos) return null;
  const showDraftPreview = !!(draftPreview?.dueDate && (!draftPreview.isEditing || draftPreview.placementChanged));
  const editMetadataItems = isEdit ? [
    !showDraftPreview && draftPreview?.dueDate ? {
      id: "due",
      text: formatFriendlyDraftPreview(draftPreview),
      color: "rgba(249,226,175,0.86)",
    } : null,
    (resolvedProject?.name || editingTask?.class_name || editingTask?.project_name) ? {
      id: "project",
      text: resolvedProject?.name || editingTask?.class_name || editingTask?.project_name,
      color: "rgba(203,166,218,0.86)",
    } : null,
    resolvedPriority ? {
      id: "priority",
      text: `P${resolvedPriority}`,
      color: resolvedPriority <= 2 ? "#f38ba8" : resolvedPriority === 3 ? "#89b4fa" : "rgba(205,214,244,0.7)",
    } : null,
    resolvedLabels.length ? {
      id: "labels",
      text: resolvedLabels.map((label) => label.name).join(", "),
      color: "#a6dac0",
    } : null,
  ].filter(Boolean) : [];

  const compactActions = (
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
      {confirmDelete ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
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
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <ActionButton
              onClick={handleSubmit}
              disabled={!canSubmit || submitting || deleting}
            >
              {submitting ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Save" : "Add task")}
            </ActionButton>
            <ActionButton subtle onClick={requestClose} disabled={submitting || deleting}>
              Cancel
            </ActionButton>
          </div>
          {isEdit ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
              <ActionButton
                dataTestId="todoist-delete"
                danger
                onClick={confirmDeleteIntent}
                disabled={deleting || submitting}
              >
                Delete
              </ActionButton>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const compactDetailPanel = openCompactPanel === "project" ? (
    <CompactOptionPanel>
      {projects.map((project) => (
        <CompactOption
          key={project.id}
          active={resolvedProject?.id === project.id}
          color={project.color || "var(--ea-accent)"}
          onClick={() => {
            setManualProject(project);
            setOverrides((prev) => ({ ...prev, project: true }));
            setOpenCompactPanel(null);
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: project.color || "rgba(205,214,244,0.3)",
              flexShrink: 0,
            }}
          />
          {project.name}
        </CompactOption>
      ))}
    </CompactOptionPanel>
  ) : openCompactPanel === "priority" ? (
    <CompactOptionPanel>
      {priorityOptions.map((option) => (
        <CompactOption
          key={option.value || "none"}
          active={resolvedPriority === option.value}
          color={option.value && option.value <= 2 ? "#f38ba8" : option.value === 3 ? "#89b4fa" : null}
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
  ) : openCompactPanel === "labels" ? (
    <CompactOptionPanel>
      {labels.length ? labels.map((label) => {
        const activeLabel = resolvedLabels.some((entry) => entry.id === label.id || entry.name === label.name);
        return (
          <CompactOption
            key={label.id}
            active={activeLabel}
            color="#a6dac0"
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
        <div style={{ color: "rgba(205,214,244,0.42)", fontSize: 11.5, padding: "6px 9px" }}>
          No labels available
        </div>
      )}
    </CompactOptionPanel>
  ) : null;

  if (isInline) {
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
        <div
          style={{
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 0,
            minHeight: 0,
            flex: 1,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div id="todoist-editor-title" style={{ fontSize: 14, color: "#cba6da", fontWeight: 500 }}>
                {isEdit ? "Edit Todoist task" : "New Todoist task"}
              </div>
              <div style={{ marginTop: 3, fontSize: 11, color: "rgba(205,214,244,0.42)", lineHeight: 1.45 }}>
                Task text can carry Todoist dates, priority, projects, and labels.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16, flex: 1, minHeight: 0 }}>
            {error && (
              <div
                style={{
                  padding: "9px 10px",
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

            {showDraftPreview ? (
              <div
                data-testid="todoist-draft-preview-summary"
                style={{
                  padding: "9px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(232,119,106,0.2)",
                  background: "rgba(232,119,106,0.07)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: "#e8776a" }}>
                  Draft preview
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "rgba(205,214,244,0.78)" }}>
                  {formatFriendlyDraftPreview(draftPreview)}
                </div>
              </div>
            ) : null}

            <div style={{ position: "relative" }}>
              <FieldLabel>Task</FieldLabel>
              <input
                ref={inputRef}
                type="text"
                data-calendar-editor-primary="true"
                inputMode="text"
                enterKeyHint="done"
                aria-label="Task title"
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

            <CompactDescriptionField
              description={description}
              setDescription={setDescription}
              isMobile={isMobile}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                data-testid="todoist-compact-toolbar"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  minWidth: 0,
                }}
              >
                <CompactIconButton
                  anchorRef={dueTriggerRef}
                  icon={CalendarClock}
                  label={dueDisplay ? `Due: ${dueDisplay}` : "Due date"}
                  active={!!dueDisplay || duePickerOpen}
                  dataTestId="todoist-due-trigger"
                  onClick={openDuePicker}
                />
                <CompactIconButton
                  icon={Folder}
                  label={`Project: ${resolvedProject?.name || "Inbox"}`}
                  active={!!resolvedProject || openCompactPanel === "project"}
                  dataTestId="todoist-project-trigger"
                  onClick={() => setOpenCompactPanel((panel) => (panel === "project" ? null : "project"))}
                />
                <CompactIconButton
                  icon={Flag}
                  label={`Priority: ${resolvedPriority ? `P${resolvedPriority}` : "None"}`}
                  active={!!resolvedPriority || openCompactPanel === "priority"}
                  danger={resolvedPriority && resolvedPriority <= 2}
                  dataTestId="todoist-priority-trigger"
                  width={resolvedPriority ? 48 : 34}
                  onClick={() => setOpenCompactPanel((panel) => (panel === "priority" ? null : "priority"))}
                >
                  {resolvedPriority ? <CompactPriorityBadge level={resolvedPriority} /> : <Flag size={15} aria-hidden />}
                </CompactIconButton>
                <CompactIconButton
                  icon={Tags}
                  label={resolvedLabels.length ? `${resolvedLabels.length} Todoist label${resolvedLabels.length === 1 ? "" : "s"}` : "Todoist labels"}
                  active={resolvedLabels.length > 0 || openCompactPanel === "labels"}
                  dataTestId="todoist-labels-trigger"
                  onClick={() => setOpenCompactPanel((panel) => (panel === "labels" ? null : "labels"))}
                />
              </div>
              {editMetadataItems.length ? (
                <div
                  data-testid="todoist-edit-metadata"
                  aria-label="Todoist task metadata"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 5,
                    minWidth: 0,
                  }}
                >
                  {editMetadataItems.map((item) => (
                    <CompactMetadataChip key={item.id} color={item.color}>
                      {item.text}
                    </CompactMetadataChip>
                  ))}
                </div>
              ) : null}
              {resolvedLabels.length ? (
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                  {resolvedLabels.map((label) => (
                    <span
                      key={label.id}
                      style={{
                        background: "rgba(166,218,203,0.1)",
                        border: "1px solid rgba(166,218,203,0.2)",
                        borderRadius: 6,
                        padding: "2px 7px",
                        color: "#a6dac0",
                        fontSize: 10.5,
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
                </div>
              ) : null}
              {compactDetailPanel}
            </div>

            <div
              style={{
                marginTop: "auto",
                paddingTop: 6,
                position: "sticky",
                bottom: -12,
                zIndex: 2,
                background: "linear-gradient(180deg, rgba(22,22,30,0), #16161e 18%)",
              }}
            >
              {compactActions}
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
  }

  const content = (
    <div
      ref={panelRef}
      data-testid={isInline ? "todoist-inline-editor" : "todoist-floating-editor"}
      data-suspend-calendar-hotkeys="true"
      role={isInline ? "region" : "dialog"}
      aria-modal={!isInline ? "true" : undefined}
      aria-labelledby="todoist-editor-title"
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
            <div id="todoist-editor-title" style={{ fontSize: 14, color: "#cba6da", fontWeight: 500 }}>
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

        {draftPreview?.dueDate && (!draftPreview.isEditing || draftPreview.placementChanged) ? (
          <div
            data-testid="todoist-draft-preview-summary"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(232,119,106,0.2)",
              background: "rgba(232,119,106,0.07)",
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: "#e8776a" }}>
              Draft preview
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "rgba(205,214,244,0.78)" }}>
              {formatFriendlyDraftPreview(draftPreview)}
            </div>
          </div>
        ) : null}

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
              data-calendar-editor-primary="true"
              inputMode="text"
              enterKeyHint="done"
              aria-label="Task title"
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
