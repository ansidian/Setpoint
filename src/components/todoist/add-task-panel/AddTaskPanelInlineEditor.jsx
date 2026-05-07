import { createElement, useState } from "react";
import { CalendarClock, Flag, Folder, Tags } from "lucide-react";
import { PriorityIndicator } from "./controls";
import { buildInlineContainerStyle } from "./styles";
import { textFieldStyle } from "../../calendar/events/calendarEditorUtils";
import {
  TodoistActionFooter,
  TodoistDraftPreview,
  TodoistDuePickerLayer,
  TodoistErrorNotice,
  TodoistSelectedLabelChips,
  TodoistTaskTextSection,
} from "./AddTaskPanelShared.jsx";

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
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, width: "100%", minWidth: 0, color }}>
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
        flex: "0 0 auto",
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
}) {
  if (openCompactPanel === "project") {
    return (
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
  );
}

function CompactActions(props) {
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
  editMetadataItems,
  openCompactPanel,
  setOpenCompactPanel,
  state,
}) {
  const {
    autocompleteType,
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
    input,
    inputRef,
    isEdit,
    isMobile,
    labels,
    panelRef,
    pickerDueEpoch,
    priorityOptions,
    projects,
    recurrenceSummary,
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
    openDuePicker,
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
            <div id="todoist-editor-title" style={{ fontSize: 14, color: "#cba6da", fontWeight: 500 }}>
              {isEdit ? "Edit Todoist task" : "New Todoist task"}
            </div>
            <div style={{ marginTop: 3, fontSize: 11, color: "rgba(205,214,244,0.42)", lineHeight: 1.45 }}>
              Task text can carry Todoist dates, priority, projects, and labels.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16, flex: 1, minHeight: 0 }}>
          <TodoistErrorNotice error={error} compact />
          <TodoistDraftPreview draftPreview={draftPreview} compact />
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
          <CompactDescriptionField description={description} setDescription={setDescription} isMobile={isMobile} />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div data-testid="todoist-compact-toolbar" style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <CompactIconButton anchorRef={dueTriggerRef} icon={CalendarClock} label={dueDisplay ? `Due: ${dueDisplay}` : "Due date"} active={!!dueDisplay || duePickerOpen} dataTestId="todoist-due-trigger" onClick={openDuePicker} />
              <CompactIconButton icon={Folder} label={`Project: ${resolvedProject?.name || "Inbox"}`} active={!!resolvedProject || openCompactPanel === "project"} dataTestId="todoist-project-trigger" onClick={() => setOpenCompactPanel((panel) => (panel === "project" ? null : "project"))} />
              <CompactIconButton icon={Flag} label={`Priority: ${resolvedPriority ? `P${resolvedPriority}` : "None"}`} active={!!resolvedPriority || openCompactPanel === "priority"} danger={resolvedPriority && resolvedPriority <= 2} dataTestId="todoist-priority-trigger" width={resolvedPriority ? 48 : 34} onClick={() => setOpenCompactPanel((panel) => (panel === "priority" ? null : "priority"))}>
                {resolvedPriority ? <CompactPriorityBadge level={resolvedPriority} /> : <Flag size={15} aria-hidden />}
              </CompactIconButton>
              <CompactIconButton icon={Tags} label={resolvedLabels.length ? `${resolvedLabels.length} Todoist label${resolvedLabels.length === 1 ? "" : "s"}` : "Todoist labels"} active={resolvedLabels.length > 0 || openCompactPanel === "labels"} dataTestId="todoist-labels-trigger" onClick={() => setOpenCompactPanel((panel) => (panel === "labels" ? null : "labels"))} />
            </div>
            {editMetadataItems.length ? (
              <div data-testid="todoist-edit-metadata" aria-label="Todoist task metadata" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, minWidth: 0 }}>
                {editMetadataItems.map((item) => (
                  <CompactMetadataChip key={item.id} color={item.color}>{item.text}</CompactMetadataChip>
                ))}
              </div>
            ) : null}
            <TodoistSelectedLabelChips
              resolvedLabels={resolvedLabels}
              setManualLabels={setManualLabels}
              setOverrides={setOverrides}
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
          </div>

          <div style={{ marginTop: "auto", paddingTop: 6, position: "sticky", bottom: -12, zIndex: 2, background: "linear-gradient(180deg, rgba(22,22,30,0), #16161e 18%)" }}>
            <CompactActions
              canSubmit={canSubmit}
              cancelDelete={cancelDelete}
              confirmDelete={confirmDelete}
              confirmDeleteIntent={confirmDeleteIntent}
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
