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
import { epochFromLa } from "../../inbox/helpers";
import { formatResolvedDate, parseTokens } from "./parsing";
import { buildManualDue, getInitialDueEpoch } from "./due";
import { deadlinePreviewFromEpoch, minutesFromDisplayTime } from "../../calendar/ghostPreview.js";
import {
  applyUpcomingReminderState,
  projectUpcomingReminderState,
} from "../../calendar/reminderDisplay.js";
import { buildDeadlineMutationPayload } from "./submitPayload";
import {
  buildTodoistReminderCreatePayload,
  createTodoistReminderDraftFromCustom,
  createTodoistReminderDraftFromOffset,
  getTodoistReminderPresetState,
  isUnsavedTodoistReminder,
  TODOIST_REMINDER_PRESETS,
  todoistAnchorFromTask,
} from "./todoistReminderModel.js";

function buildSeededDue(initialDueDate) {
  if (!initialDueDate) return null;
  const [year, month, day] = String(initialDueDate).split("-").map(Number);
  if (!year || !month || !day) return null;
  return buildManualDue(epochFromLa(year, month - 1, day, 9, 0));
}

function displayTimeToInputValue(dueTime) {
  if (!dueTime) return "09:00";
  const match = String(dueTime).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!match) return "09:00";
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3].toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export default function useAddTaskPanelController({
  anchorRef,
  onClose,
  onTaskAdded,
  editingTask,
  onTaskUpdated,
  onTaskDeleted,
  host = "anchored",
  initialDueDate = null,
  onDraftPreviewChange,
  onDirtyChange,
}) {
  const isInline = host === "inline";
  const isEdit = !!editingTask;
  const [input, setInput] = useState(() => editingTask?.title || "");
  const [description, setDescription] = useState(() => editingTask?.description || "");
  const [projects, setProjects] = useState([]);
  const [labels, setLabels] = useState([]);
  const [manualProject, setManualProject] = useState(null);
  const [manualPriority, setManualPriority] = useState(editingTask?.priority ?? null);
  const [manualLabels, setManualLabels] = useState(
    editingTask?.labels?.length
      ? editingTask.labels.map((name) => ({ id: `name:${name}`, name, color: "#cba6da" }))
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
  const seededDueDisplay = useMemo(() => {
    if (editingTask?.due_date) {
      const [year, month, day] = editingTask.due_date.split("-").map(Number);
      if (!year || !month || !day) return null;
      const date = new Date(year, month - 1, day);
      let time = null;
      if (editingTask.due_time) {
        const match = editingTask.due_time.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
        if (match) {
          let hour = parseInt(match[1], 10);
          const minute = match[2] ? parseInt(match[2], 10) : 0;
          const ampm = match[3].toLowerCase();
          if (ampm === "pm" && hour < 12) hour += 12;
          if (ampm === "am" && hour === 12) hour = 0;
          time = { hour, minute };
        }
      }
      return formatResolvedDate({ date, time });
    }
    return seededCreateDue?.display || null;
  }, [editingTask?.due_date, editingTask?.due_time, seededCreateDue]);
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
  const [pos, setPos] = useState(null);
  const isMobile = useIsMobile();
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [autocompleteType, setAutocompleteType] = useState(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [visible, setVisible] = useState(() => isInline);
  const [closing, setClosing] = useState(false);
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [duePickerNow, setDuePickerNow] = useState(() => Date.now());
  const panelRef = useRef(null);
  const closeTimerRef = useRef(null);
  const inputRef = useRef(null);
  const dueTriggerRef = useRef(null);
  const duePickerRef = useRef(null);

  const requestClose = useCallback(() => {
    if (isInline) {
      onClose();
      return;
    }
    if (closeTimerRef.current) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, 180);
  }, [isInline, onClose]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

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
  const resolvedLabels = useMemo(() => (
    overrides.labels
      ? manualLabels || []
      : parsed.labels.length
        ? parsed.labels
        : []
  ), [manualLabels, overrides.labels, parsed.labels]);
  const resolvedDue = overrides.due
    ? manualDue?.dueString || null
    : parsed.recurringDueString || parsed.dateDueString || parsed.datePhrase || seededCreateDue?.dueString || null;
  const dueDisplay = manualDue?.display || parsed.dateFormatted || seededDueDisplay || "";
  const recurrenceSummary = !overrides.due ? parsed.recurrenceSummary : null;
  const pickerDueEpoch = manualDue?.epochMs ?? seededDueEpoch;
  const draftPreview = useMemo(() => {
    const manualPreview = manualDue?.epochMs != null ? deadlinePreviewFromEpoch(manualDue.epochMs) : null;
    const parsedPreview = !overrides.due ? parsed.duePreview : null;
    const seededPreview = seededDueEpoch != null ? deadlinePreviewFromEpoch(seededDueEpoch) : null;
    const due = manualPreview || parsedPreview || seededPreview;
    if (!due?.dueDate) return null;
    const dueMinutes = due.dueMinutes ?? minutesFromDisplayTime(due.dueTime);
    const originalMinutes = minutesFromDisplayTime(editingTask?.due_time);
    const placementChanged = !isEdit
      || due.dueDate !== editingTask?.due_date
      || (dueMinutes ?? null) !== (originalMinutes ?? null);
    return {
      kind: "deadline",
      title: parsed.stripped || input.trim() || editingTask?.title || "",
      dueDate: due.dueDate,
      dueTime: due.dueTime || null,
      priority: resolvedPriority,
      source: "todoist",
      isEditing: isEdit,
      placementChanged,
    };
  }, [editingTask?.due_date, editingTask?.due_time, editingTask?.title, input, isEdit, manualDue?.epochMs, overrides.due, parsed.duePreview, parsed.stripped, resolvedPriority, seededDueEpoch]);

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

  const originalDueValue = useMemo(() => (
    editingTask
      ? editingTask.due_string || [editingTask.due_date, editingTask.due_time].filter(Boolean).join(" ") || null
      : seededCreateDue?.dueString || null
  ), [editingTask, seededCreateDue?.dueString]);

  const dirtySnapshot = useMemo(() => JSON.stringify({
    content: String(parsed.stripped || input || "").trim(),
    description: String(description || "").trim(),
    project: resolvedProject?.name || resolvedProject?.id || null,
    priority: resolvedPriority || null,
    labels: (resolvedLabels || []).map((label) => label.name).sort(),
    due: isEdit && !overrides.due ? originalDueValue : resolvedDue || null,
  }), [description, input, isEdit, originalDueValue, overrides.due, parsed.stripped, resolvedDue, resolvedLabels, resolvedPriority, resolvedProject?.id, resolvedProject?.name]);

  const dirtyBaseline = useMemo(() => JSON.stringify({
    content: String(editingTask?.title || "").trim(),
    description: String(editingTask?.description || "").trim(),
    project: editingTask
      ? editingTask.project_id || editingTask.project_name || editingTask.class_name || null
      : null,
    priority: editingTask?.priority || null,
    labels: (editingTask?.labels || []).map((name) => String(name)).sort(),
    due: originalDueValue,
  }), [editingTask, originalDueValue]);
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

  const updatePos = useCallback(() => {
    if (isInline) {
      setPos({ inline: true });
      return;
    }
    if (host === "modal") {
      setPos({ modal: true });
      return;
    }
    if (isMobile) {
      setPos({ mobile: true });
      return;
    }
    if (!anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const panelWidth = 360;
    const measuredHeight = panelRef.current?.offsetHeight;
    const panelHeight = measuredHeight && measuredHeight > 80 ? measuredHeight : 520;
    const margin = 12;

    let left = rect.left;
    if (left + panelWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - panelWidth - margin);
    }
    if (left < margin) left = margin;

    let top = rect.bottom + 8;
    if (top + panelHeight > window.innerHeight - margin) {
      const aboveTop = rect.top - panelHeight - 8;
      if (aboveTop > margin) top = aboveTop;
      else top = Math.max(margin, window.innerHeight - panelHeight - margin);
    }

    setPos({ top, left, width: panelWidth });
  }, [anchorRef, isInline, host, isMobile]);

  useEffect(() => {
    if (isInline) return undefined;
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [isInline, updatePos]);

  // Track virtual-keyboard height on mobile so the bottom-sheet sits above it.
  useEffect(() => {
    if (isInline) return undefined;
    if (!isMobile || typeof window === "undefined" || !window.visualViewport) {
      setKeyboardOffset(0);
      return undefined;
    }
    const vv = window.visualViewport;
    const onResize = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardOffset(offset);
    };
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    onResize();
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, [isInline, isMobile]);

  useEffect(() => {
    if (isInline) return undefined;
    const element = panelRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => updatePos());
    observer.observe(element);
    return () => observer.disconnect();
  }, [isInline, updatePos]);

  useEffect(() => {
    if (isInline) {
      inputRef.current?.focus({ preventScroll: true });
      return undefined;
    }

    const raf = requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [isInline]);

  useEffect(() => {
    if (isInline) return undefined;
    function handleClick(event) {
      if (anchorRef?.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      if (duePickerRef.current?.contains(event.target)) return;
      requestClose();
    }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [anchorRef, isInline, requestClose]);

  useEffect(() => {
    function handleKey(event) {
      if (event.key !== "Escape") return;
      if (duePickerOpen) {
        event.preventDefault();
        setDuePickerOpen(false);
        return;
      }
      requestClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [duePickerOpen, requestClose]);

  useEffect(() => {
    if (!isMobile || isInline) return undefined;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [isInline, isMobile]);

  useEffect(() => {
    const element = panelRef.current;
    if (!element) return undefined;
    function handleWheel(event) {
      const { scrollTop, scrollHeight, clientHeight } = element;
      const atTop = scrollTop <= 0 && event.deltaY < 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && event.deltaY > 0;
      if (atTop || atBottom) event.preventDefault();
    }
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  const canSubmit = parsed.stripped.length > 0 || input.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    inputRef.current?.blur();
    setSubmitting(true);
    setError(null);
    try {
      const payload = buildDeadlineMutationPayload({
        parsed,
        input,
        description,
        resolvedProject,
        resolvedPriority,
        resolvedLabels,
        resolvedDue,
        isEdit,
      });

      let task;
      if (isEdit) {
        task = await updateDeadline(editingTask.id, payload);
      } else {
        task = await createDeadline(payload);
      }
      const savedTask = isEdit ? { ...editingTask, ...task, id: editingTask.id } : task;
      for (const reminderId of removedReminderIds) {
        await deleteReminder(reminderId);
      }
      let reminderCreates = 0;
      for (const reminder of todoistReminders) {
        if (!isUnsavedTodoistReminder(reminder)) continue;
        await createReminder(buildTodoistReminderCreatePayload({
          task: savedTask,
          reminder,
        }));
        reminderCreates += 1;
      }
      const remindersChanged = removedReminderIds.length > 0 || reminderCreates > 0;
      const shouldProjectReminderState = remindersChanged || todoistReminders.length > 0;
      const projectedTask = shouldProjectReminderState
        ? applyUpcomingReminderState(
          savedTask,
          projectUpcomingReminderState(todoistReminders, {
            anchorAt: todoistAnchorFromTask(savedTask)?.anchorAt || null,
          }),
        )
        : savedTask;
      if (isEdit) {
        onTaskUpdated?.(projectedTask);
      } else {
        onTaskAdded?.(projectedTask);
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
