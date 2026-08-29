import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import {
  createDeadline,
  createReminder,
  deleteDeadline,
  deleteReminder,
  updateDeadline,
} from "../../../api";
import useIsMobile from "../../../hooks/useIsMobile";
import { parseTokens, parseTokensWithChrono } from "./parsing";
import { ensureChrono, isChronoReady } from "../../calendar/events/parseCalendarTitle";
import {
  buildManualDue,
  getInitialDueEpoch,
  buildSeededDue,
  buildSeededDueDisplay,
} from "./due";
import {
  resolveAddTaskLabels,
  resolveAddTaskDue,
  buildAddTaskDraftPreview,
  buildOriginalDueValue,
  buildAddTaskDirtySnapshot,
  buildAddTaskDirtyBaseline,
} from "./addTaskViewModel";
import { canSubmitTask, withRequiredDescriptionSuffix } from "./submitPayload";
import { submitAddTaskFlow } from "./submitAddTaskFlow";
import useAddTaskPanelPlacement from "./useAddTaskPanelPlacement";
import useDirtyCloseConfirmation from "./useDirtyCloseConfirmation";
import useTodoistReminderDrafts from "./useTodoistReminderDrafts";
import {
  getCachedTodoistLabels,
  getCachedTodoistProjects,
} from "./todoistReferenceCache";
import type { TodoistLabel, TodoistPriority, TodoistProject, TodoistTask } from "../../../../shared/types/tasks";
import type {
  AddTaskOverrides,
  AddTaskPanelProps,
  AutocompleteType,
  ManualDue,
} from "./types";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function useAddTaskPanelController({
  anchorRef,
  onClose,
  onTaskAdded,
  editingTask,
  onTaskUpdated,
  onTaskDeleted,
  host = "anchored",
  initialDueDate = null, initialDueEpochMs = null,
  initialInput = "",
  initialDescription = "",
  descriptionVariant = "default", confirmDirtyCloseInline = false,
  onDraftPreviewChange,
  onDirtyChange,
  requireDue = false, supportingContext = null, requiredDescriptionSuffix = null,
}: AddTaskPanelProps) {
  const isInline = host === "inline";
  const isEdit = !!editingTask;
  // Seed from initialInput/initialDescription only in CREATE mode; in edit mode
  // the editingTask always wins (even with a falsy title), matching the
  // !editingTask-guarded seededCreateDue pattern below.
  const [input, setInput] = useState(() => (editingTask ? editingTask.title || "" : initialInput || ""));
  const [description, setDescription] = useState(() => (editingTask ? editingTask.description || "" : initialDescription || ""));
  const [projects, setProjects] = useState<TodoistProject[]>([]);
  const [labels, setLabels] = useState<TodoistLabel[]>([]);
  const [manualProject, setManualProject] = useState<TodoistProject | null>(null);
  const [manualPriority, setManualPriority] = useState<TodoistPriority>(editingTask?.priority ?? null);
  const [manualLabels, setManualLabels] = useState<TodoistLabel[] | null>(
    editingTask?.labels?.length
      ? editingTask.labels.map((name) => ({ id: `name:${name}`, name, color: "var(--sp-accent)" }))
      : null,
  );
  const seededCreateDue = useMemo(
    () => (!editingTask ? (initialDueEpochMs ? buildManualDue(initialDueEpochMs) : buildSeededDue(initialDueDate)) : null),
    [editingTask, initialDueDate, initialDueEpochMs],
  );
  const seededDueEpoch = useMemo(
    () => getInitialDueEpoch(editingTask) ?? seededCreateDue?.epochMs ?? null,
    [editingTask, seededCreateDue],
  );
  const [manualDue, setManualDue] = useState<ManualDue | null>(null);
  const [overrides, setOverrides] = useState<AddTaskOverrides>(
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
  const [error, setError] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isMobile = useIsMobile();
  const [autocompleteType, setAutocompleteType] = useState<AutocompleteType>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [duePickerNow, setDuePickerNow] = useState(() => Date.now());
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dueTriggerRef = useRef<HTMLButtonElement | null>(null);
  const duePickerRef = useRef<HTMLDivElement | null>(null);
  // Once a create succeeds, remember the new task so a retry (e.g. after a
  // reminder-create failure) updates it instead of creating a duplicate.
  const committedTaskRef = useRef<TodoistTask | null>(null);
  const dirtyClose = useDirtyCloseConfirmation(confirmDirtyCloseInline);

  const { pos, keyboardOffset, visible, closing, requestClose } = useAddTaskPanelPlacement({
    isInline, host, isMobile, onClose, anchorRef, panelRef, inputRef,
    duePickerRef, duePickerOpen, setDuePickerOpen,
    beforeClose: dirtyClose.beforeClose,
  });

  const closeWithoutDirtyConfirmation = useCallback(() => {
    dirtyClose.allowNextClose(); requestClose();
  }, [dirtyClose, requestClose]);
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
      closeWithoutDirtyConfirmation();
    } catch (err) {
      setError(errorMessage(err, "Failed to delete task"));
      setDeleting(false);
    }
  }, [closeWithoutDirtyConfirmation, deleting, editingTask, isEdit, onTaskDeleted]);

  useEffect(() => {
    getCachedTodoistProjects()
      .then((list) => {
        const sorted = [...list].sort((a, b) => {
          if (a.isInbox) return -1;
          if (b.isInbox) return 1;
          return 0;
        });
        setProjects(sorted);
      })
      .catch(() => {});
    getCachedTodoistLabels().then(setLabels).catch(() => {});
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

  const reminderDrafts = useTodoistReminderDrafts({
    editingTask,
    initialDueDate,
    draftPreview,
    input,
    parsedTitle: parsed.stripped,
    resolvedProject,
  });
  const { todoistReminders, removedReminderIds } = reminderDrafts;

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
  const isDirty = !isEdit && input === initialInput && description === initialDescription && !Object.keys(overrides).length && !todoistReminders.length && !removedReminderIds.length ? false : dirtySnapshot !== dirtyBaseline;
  dirtyClose.setDirty(isDirty);

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

  const handleDueSelect = useCallback((epochMs: number) => {
    setManualDue(buildManualDue(epochMs));
    setOverrides((prev) => ({ ...prev, due: true }));
    setDuePickerOpen(false);
  }, []);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setTitleTouched(true);
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

  const handleAutocompleteSelect = useCallback((
    item: TodoistProject | TodoistLabel,
    triggerIdx: number,
    selectionCursorPos: number,
  ) => {
    const trigger = input[triggerIdx]!;
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

  const hasTitle = canSubmitTask({ parsed, input });
  const titleError = titleTouched && !hasTitle ? "Enter a title." : null;
  const canSubmit = hasTitle && (!requireDue || !!resolvedDue);

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
        description: withRequiredDescriptionSuffix(description, requiredDescriptionSuffix),
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
        reminderDrafts.reportReminderMutationFailure(created + deleted > 0);
        return;
      }
      closeWithoutDirtyConfirmation();
    } catch (err) {
      setError(errorMessage(err, "Failed to create task"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (autocompleteType) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!hasTitle) setTitleTouched(true);
      if (confirmDelete) deleteTask();
      else handleSubmit();
    }
  };

  const handleInputBlur = () => {
    setTitleTouched(true);
  };

  const priorityOptions: Array<{ value: TodoistPriority; label: string }> = [
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
    confirmDelete, confirmDiscard: dirtyClose.confirming,
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
    todoistReminderPresetStates: reminderDrafts.todoistReminderPresetStates,
    reminderError: reminderDrafts.reminderError,
    customReminder: reminderDrafts.customReminder,
    hasReminderAnchor: reminderDrafts.hasReminderAnchor,
    updateCustomReminder: reminderDrafts.updateCustomReminder,
    addTodoistReminderPreset: reminderDrafts.addTodoistReminderPreset,
    addCustomTodoistReminder: reminderDrafts.addCustomTodoistReminder,
    removeTodoistReminder: reminderDrafts.removeTodoistReminder,
    openDuePicker,
    closeDuePicker,
    handleDueSelect,
    handleInputChange,
    handleInputBlur,
    handleAutocompleteSelect,
    canSubmit,
    titleError,
    handleSubmit,
    confirmDeleteIntent, cancelDiscard: dirtyClose.cancel,
    confirmDiscardChanges: closeWithoutDirtyConfirmation,
    deleteTask,
    handleKeyDown,
    priorityOptions,
    active: isInline || (visible && !closing),
    requestClose,
    cancelDelete,
    host,
    isInline, supportingContext, descriptionVariant,
  };
}
