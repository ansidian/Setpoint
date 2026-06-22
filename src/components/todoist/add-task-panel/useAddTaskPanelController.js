import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDeadline,
  createReminder,
  deleteDeadline,
  deleteReminder,
  getTodoistLabels,
  getTodoistProjects,
  listReminders,
  updateDeadline,
} from "../../../api";
import useIsMobile from "../../../hooks/useIsMobile";
import { parseTokens, parseTokensWithChrono } from "./parsing";
import { ensureChrono, isChronoReady } from "../../calendar/events/parseCalendarTitle";
import {
  buildManualDue,
  getInitialDueEpoch,
  buildSeededDue,
  displayTimeToInputValue,
  buildSeededDueDisplay,
} from "./due";
import {
  resolveAddTaskLabels,
  resolveAddTaskDue,
  buildAddTaskDraftPreview,
  buildOriginalDueValue,
  buildAddTaskDirtySnapshot,
  buildAddTaskDirtyBaseline,
} from "./addTaskViewModel.js";
import { canSubmitTask } from "./submitPayload";
import { submitAddTaskFlow } from "./submitAddTaskFlow.js";
import useAddTaskPanelPlacement from "./useAddTaskPanelPlacement.js";
import {
  createTodoistReminderDraftFromCustom,
  createTodoistReminderDraftFromOffset,
  getTodoistReminderPresetState,
  TODOIST_REMINDER_PRESETS,
} from "./todoistReminderModel.js";

export default function useAddTaskPanelController({
  anchorRef,
  onClose,
  onTaskAdded,
  editingTask,
  onTaskUpdated,
  onTaskDeleted,
  host = "anchored",
  initialDueDate = null,
  initialInput = "",
  initialDescription = "",
  onDraftPreviewChange,
  onDirtyChange,
}) {
  const isInline = host === "inline";
  const isEdit = !!editingTask;
  // Seed from initialInput/initialDescription only in CREATE mode; in edit mode
  // the editingTask always wins (even with a falsy title), matching the
  // !editingTask-guarded seededCreateDue pattern below.
  const [input, setInput] = useState(() => (editingTask ? editingTask.title || "" : initialInput || ""));
  const [description, setDescription] = useState(() => (editingTask ? editingTask.description || "" : initialDescription || ""));
  const [projects, setProjects] = useState([]);
  const [labels, setLabels] = useState([]);
  const [manualProject, setManualProject] = useState(null);
  const [manualPriority, setManualPriority] = useState(editingTask?.priority ?? null);
  const [manualLabels, setManualLabels] = useState(
    editingTask?.labels?.length
      ? editingTask.labels.map((name) => ({ id: `name:${name}`, name, color: "var(--sp-accent)" }))
      : null,
  );
  const seededCreateDue = useMemo(
    () => (!editingTask ? buildSeededDue(initialDueDate) : null),
    [editingTask, initialDueDate],
  );
  const seededDueEpoch = useMemo(
    () => getInitialDueEpoch(editingTask) ?? seededCreateDue?.epochMs ?? null,
    [editingTask, seededCreateDue],
  );
  const [manualDue, setManualDue] = useState(null);
  const [overrides, setOverrides] = useState(
    editingTask
      ? {
        project: false,
        priority: editingTask.priority != null,
        labels: !!editingTask.labels?.length,
        due: false,
      }
      : {},
  );
  const seededDueDisplay = useMemo(
    () => buildSeededDueDisplay({
      dueDate: editingTask?.due_date,
      dueTime: editingTask?.due_time,
      seededCreateDue,
    }),
    [editingTask?.due_date, editingTask?.due_time, seededCreateDue],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [todoistReminders, setTodoistReminders] = useState([]);
  const [removedReminderIds, setRemovedReminderIds] = useState([]);
  const [reminderError, setReminderError] = useState(null);
  const [customReminder, setCustomReminder] = useState(() => ({
    date: editingTask?.due_date || initialDueDate || "",
    time: displayTimeToInputValue(editingTask?.due_time),
  }));
  const isMobile = useIsMobile();
  const [autocompleteType, setAutocompleteType] = useState(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [duePickerNow, setDuePickerNow] = useState(() => Date.now());
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const dueTriggerRef = useRef(null);
  const duePickerRef = useRef(null);
  // Once a create succeeds, remember the new task so a retry (e.g. after a
  // reminder-create failure) updates it instead of creating a duplicate.
  const committedTaskRef = useRef(null);

  const { pos, keyboardOffset, visible, closing, requestClose } = useAddTaskPanelPlacement({
    isInline,
    host,
    isMobile,
    onClose,
    anchorRef,
    panelRef,
    inputRef,
    duePickerRef,
    duePickerOpen,
    setDuePickerOpen,
  });

  const confirmDeleteIntent = useCallback(() => {
    if (!isEdit || deleting) return;
    setConfirmDelete(true);
    setError(null);
  }, [deleting, isEdit]);

  const cancelDelete = useCallback(() => {
    setConfirmDelete(false);
  }, []);

  const deleteTask = useCallback(async () => {
    if (!isEdit || deleting || !editingTask?.id) return;
    setError(null);
    setDeleting(true);
    try {
      await deleteDeadline(editingTask.id);
      onTaskDeleted?.(editingTask.id);
      requestClose();
    } catch (err) {
      setError(err.message || "Failed to delete task");
      setDeleting(false);
    }
  }, [deleting, editingTask, isEdit, onTaskDeleted, requestClose]);

  useEffect(() => {
    getTodoistProjects()
      .then((list) => {
        const sorted = [...list].sort((a, b) => {
          if (a.isInbox) return -1;
          if (b.isInbox) return 1;
          return 0;
        });
        setProjects(sorted);
      })
      .catch(() => {});
    getTodoistLabels().then(setLabels).catch(() => {});
  }, []);

  // Warm chrono-node on mount so the common paste-then-submit case usually has the
  // natural-language parser already loaded. Best-effort only and sets NO state — a
  // post-mount setState would land mid workspace-switch transition and flake (the
  // reverted chronoReadyTick fix did exactly that). The submit-time await in
  // handleSubmit is the actual correctness guarantee; this just shrinks the window.
  useEffect(() => {
    ensureChrono();
  }, []);

  useEffect(() => {
    if (!editingTask || !projects.length || manualProject) return;
    const match = projects.find((project) => project.name === editingTask.class_name);
    if (match) {
      setManualProject(match);
      setOverrides((prev) => ({ ...prev, project: true }));
    }
  }, [editingTask, manualProject, projects]);

  useEffect(() => {
    if (!editingTask || !labels.length) return;
    setManualLabels((prev) => {
      if (!prev?.length) return prev;
      const needsResolve = prev.some((label) => String(label.id).startsWith("name:"));
      if (!needsResolve) return prev;
      return prev.map((label) => {
        if (!String(label.id).startsWith("name:")) return label;
        const real = labels.find((entry) => entry.name === label.name);
        return real || label;
      });
    });
  }, [editingTask, labels]);

  useEffect(() => {
    let cancelled = false;
    setTodoistReminders([]);
    setRemovedReminderIds([]);
    setReminderError(null);
    if (!editingTask?.id) return undefined;
    listReminders({
      sourceType: "todoist_task",
      sourceItemId: editingTask.id,
    })
      .then((result) => {
        if (!cancelled) setTodoistReminders(result.reminders || []);
      })
      .catch((err) => {
        if (!cancelled) setReminderError(err.message || "Failed to load reminders.");
      });
    return () => {
      cancelled = true;
    };
  }, [editingTask?.id]);

  const seededNlpDueDate = !editingTask ? initialDueDate : null;
  const parsed = useMemo(
    () => parseTokens(input, projects, labels, { seededDueDate: seededNlpDueDate }),
    [input, labels, projects, seededNlpDueDate],
  );

  const resolvedProject = overrides.project ? manualProject : parsed.project || null;
  const resolvedPriority = overrides.priority ? manualPriority : parsed.priority || null;
  const resolvedLabels = useMemo(
    () => resolveAddTaskLabels({ useManualLabels: overrides.labels, manualLabels, parsedLabels: parsed.labels }),
    [manualLabels, overrides.labels, parsed.labels],
  );
  const { resolvedDue, dueDisplay, recurrenceSummary, pickerDueEpoch } = resolveAddTaskDue({
    useManualDue: overrides.due,
    manualDue,
    parsed,
    seededCreateDue,
    seededDueDisplay,
    seededDueEpoch,
  });
  const draftPreview = useMemo(
    () => buildAddTaskDraftPreview({
      manualDueEpochMs: manualDue?.epochMs ?? null,
      useManualDue: overrides.due,
      parsedDuePreview: parsed.duePreview,
      parsedStripped: parsed.stripped,
      seededDueEpoch,
      editingDueDate: editingTask?.due_date,
      editingDueTime: editingTask?.due_time,
      editingTitle: editingTask?.title,
      isEdit,
      input,
      resolvedPriority,
    }),
    [editingTask?.due_date, editingTask?.due_time, editingTask?.title, input, isEdit, manualDue?.epochMs, overrides.due, parsed.duePreview, parsed.stripped, resolvedPriority, seededDueEpoch],
  );

  const reminderDraftTask = useMemo(() => ({
    ...(editingTask || {}),
    id: editingTask?.id || null,
    title: parsed.stripped || input.trim() || editingTask?.title || "",
    due_date: draftPreview?.dueDate || editingTask?.due_date || null,
    due_time: draftPreview?.dueTime || editingTask?.due_time || null,
    class_name: resolvedProject?.name || editingTask?.class_name || editingTask?.project_name || "Todoist",
    class_color: resolvedProject?.color || editingTask?.class_color || null,
    url: editingTask?.url || null,
  }), [draftPreview?.dueDate, draftPreview?.dueTime, editingTask, input, parsed.stripped, resolvedProject?.color, resolvedProject?.name]);
  const hasReminderAnchor = !!reminderDraftTask.due_date;

  useEffect(() => {
    if (!reminderDraftTask.due_date) return;
    setCustomReminder((current) => ({
      date: current.date || reminderDraftTask.due_date,
      time: current.time || displayTimeToInputValue(reminderDraftTask.due_time),
    }));
  }, [reminderDraftTask.due_date, reminderDraftTask.due_time]);

  const originalDueValue = useMemo(
    () => buildOriginalDueValue({ editingTask, seededDueString: seededCreateDue?.dueString }),
    [editingTask, seededCreateDue?.dueString],
  );

  const dirtySnapshot = useMemo(
    () => buildAddTaskDirtySnapshot({
      parsedStripped: parsed.stripped,
      input,
      description,
      resolvedProjectName: resolvedProject?.name,
      resolvedProjectId: resolvedProject?.id,
      resolvedPriority,
      resolvedLabels,
      isEdit,
      useManualDue: overrides.due,
      originalDueValue,
      resolvedDue,
    }),
    [description, input, isEdit, originalDueValue, overrides.due, parsed.stripped, resolvedDue, resolvedLabels, resolvedPriority, resolvedProject?.id, resolvedProject?.name],
  );

  const dirtyBaseline = useMemo(
    () => buildAddTaskDirtyBaseline({ editingTask, originalDueValue }),
    [editingTask, originalDueValue],
  );
  const isDirty = dirtySnapshot !== dirtyBaseline;

  useEffect(() => {
    onDraftPreviewChange?.(draftPreview);
  }, [draftPreview, onDraftPreviewChange]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const openDuePicker = useCallback(() => {
    setDuePickerOpen((prev) => {
      const next = !prev;
      if (next) setDuePickerNow(Date.now());
      return next;
    });
  }, []);

  const closeDuePicker = useCallback(() => {
    setDuePickerOpen(false);
  }, []);

  const updateCustomReminder = useCallback((patch) => {
    setCustomReminder((current) => ({ ...current, ...patch }));
    setReminderError(null);
  }, []);

  const addTodoistReminderDraft = useCallback((nextReminder) => {
    if (nextReminder.blocked) {
      setReminderError(nextReminder.blockReason === "duplicate"
        ? "That reminder is already on this task."
        : nextReminder.blockReason === "past"
          ? "Choose a future reminder time."
          : "Choose a due date before adding a reminder.");
      return;
    }
    setTodoistReminders((current) => [...current, nextReminder]);
    setReminderError(null);
  }, []);

  const addTodoistReminderPreset = useCallback((offsetMinutes) => {
    addTodoistReminderDraft(createTodoistReminderDraftFromOffset({
      task: reminderDraftTask,
      offsetMinutes,
      existingReminders: todoistReminders,
    }));
  }, [addTodoistReminderDraft, reminderDraftTask, todoistReminders]);

  const addCustomTodoistReminder = useCallback((selection = null) => {
    const reminderSelection = selection || customReminder;
    addTodoistReminderDraft(createTodoistReminderDraftFromCustom({
      task: reminderDraftTask,
      reminderDate: reminderSelection.date,
      reminderTime: reminderSelection.time,
      existingReminders: todoistReminders,
    }));
  }, [addTodoistReminderDraft, customReminder, reminderDraftTask, todoistReminders]);

  const todoistReminderPresetStates = useMemo(() => {
    return Object.fromEntries(TODOIST_REMINDER_PRESETS.map((preset) => [
      preset.offsetMinutes,
      getTodoistReminderPresetState({
        task: reminderDraftTask,
        offsetMinutes: preset.offsetMinutes,
        existingReminders: todoistReminders,
      }),
    ]));
  }, [reminderDraftTask, todoistReminders]);

  const removeTodoistReminder = useCallback((reminder) => {
    if (reminder?.id) {
      setRemovedReminderIds((current) => (
        current.includes(reminder.id) ? current : [...current, reminder.id]
      ));
    }
    setTodoistReminders((current) => current.filter((entry) => {
      if (reminder?.id) return entry.id !== reminder.id;
      return entry.clientId !== reminder?.clientId;
    }));
    setReminderError(null);
  }, []);

  const handleDueSelect = useCallback((epochMs) => {
    setManualDue(buildManualDue(epochMs));
    setOverrides((prev) => ({ ...prev, due: true }));
    setDuePickerOpen(false);
  }, []);

  const handleInputChange = (event) => {
    const value = event.target.value;
    setInput(value);
    const cursor = event.target.selectionStart ?? value.length;
    setCursorPos(cursor);
    const before = value.slice(0, cursor);
    const lastHash = before.lastIndexOf("#");
    const lastAt = before.lastIndexOf("@");
    if (lastHash >= 0 && !/\s/.test(before.slice(lastHash + 1))) {
      setAutocompleteType("project");
    } else if (lastAt >= 0 && !/\s/.test(before.slice(lastAt + 1))) {
      setAutocompleteType("label");
    } else {
      setAutocompleteType(null);
    }
  };

  const handleAutocompleteSelect = useCallback((item, triggerIdx, selectionCursorPos) => {
    const trigger = input[triggerIdx];
    const before = input.slice(0, triggerIdx);
    const after = input.slice(selectionCursorPos);
    const newInput = `${before}${trigger}${item.name}${after ? ` ${after.trimStart()}` : " "}`;
    setInput(newInput);
    setAutocompleteType(null);

    if (trigger === "#") {
      setManualProject(item);
      setOverrides((prev) => ({ ...prev, project: true }));
    } else if (trigger === "@") {
      setManualLabels((prev) => {
        const existing = prev || [];
        if (existing.find((label) => label.id === item.id)) return existing;
        return [...existing, item];
      });
      setOverrides((prev) => ({ ...prev, labels: true }));
    }

    setTimeout(() => {
      const element = inputRef.current;
      if (element) {
        element.focus();
        const nextPos = before.length + trigger.length + item.name.length + 1;
        element.setSelectionRange(nextPos, nextPos);
      }
    }, 0);
  }, [input]);

  // Base canSubmit on the effective (token-stripped) title so tokens-only input
  // like "#Work @home" disables submit instead of firing a doomed 400.
  const canSubmit = canSubmitTask({ parsed, input });

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    inputRef.current?.blur();
    setSubmitting(true);
    setError(null);
    try {
      const { committedTask, projectedTask, created, deleted, errors } = await submitAddTaskFlow({
        parsed,
        resolvedDue,
        overrides,
        input,
        projects,
        labels,
        seededNlpDueDate,
        seededCreateDue,
        description,
        resolvedProject,
        resolvedPriority,
        resolvedLabels,
        isEdit,
        editingTask,
        todoistReminders,
        removedReminderIds,
        committedTask: committedTaskRef.current,
        createDeadline,
        updateDeadline,
        createReminder,
        deleteReminder,
        parseTokensWithChrono,
        isChronoReady,
      });
      committedTaskRef.current = committedTask;

      if (isEdit) {
        onTaskUpdated?.(projectedTask);
      } else {
        onTaskAdded?.(projectedTask);
      }

      if (errors.length > 0) {
        // Deadline saved, but some reminders did not. Keep the panel open and
        // surface the reminder failure so the user can retry/reconcile rather than
        // closing on a half-applied state with stale badges.
        setReminderError(
          created + deleted > 0
            ? "Task saved, but some reminders could not be updated."
            : "Task saved, but reminders could not be updated.",
        );
        return;
      }
      requestClose();
    } catch (err) {
      setError(err.message || "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (event) => {
    if (autocompleteType) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (confirmDelete) deleteTask();
      else handleSubmit();
    }
  };

  const priorityOptions = [
    { value: null, label: "None" },
    { value: 1, label: "P1 — Urgent" },
    { value: 2, label: "P2 — High" },
    { value: 3, label: "P3 — Medium" },
    { value: 4, label: "P4 — Low" },
  ];

  return {
    isEdit,
    editingTask,
    input,
    setInput,
    description,
    setDescription,
    projects,
    labels,
    manualProject,
    setManualProject,
    manualPriority,
    setManualPriority,
    manualLabels,
    setManualLabels,
    overrides,
    setOverrides,
    seededDueDisplay,
    seededDueEpoch,
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
    parsed,
    recurrenceSummary,
    resolvedProject,
    resolvedPriority,
    resolvedLabels,
    resolvedDue,
    dueDisplay,
    draftPreview,
    isDirty,
    duePickerOpen,
    duePickerNow,
    todoistReminders,
    todoistReminderPresetStates,
    reminderError,
    customReminder,
    hasReminderAnchor,
    updateCustomReminder,
    addTodoistReminderPreset,
    addCustomTodoistReminder,
    removeTodoistReminder,
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
    active: isInline || (visible && !closing),
    requestClose,
    cancelDelete,
    host,
    isInline,
  };
}
