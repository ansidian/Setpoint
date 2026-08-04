# Todoist Add-Task Panel Map

This directory owns the Todoist create/edit panel used by Notes promotion, Dashboard detail editing, and Calendar deadline entry. Keep its provider-facing data normalized through `src/api.ts` and the shared task/reminder contracts; do not call Todoist directly from the client.

## Files

- `useAddTaskPanelController.ts` — form, parser, reference-cache, submit, delete, and dirty/preview state orchestration.
- `useAddTaskPanelPlacement.ts` — anchored/modal/mobile/inline placement, focus, dismissal, keyboard offset, scroll lock, and wheel containment.
- `useDirtyCloseConfirmation.ts` — optional inline dirty-exit confirmation state used by embedded workspaces.
- `useTodoistReminderDrafts.ts` — reminder loading, task-anchor projection, draft validation, removal, and reconciliation-error state.
- `AddTaskPanelView.tsx` — chooses the inline editor or the portaled floating editor.
- `AddTaskPanelFloatingEditor.tsx` / `AddTaskPanelInlineEditor.tsx` — host-specific render trees; both consume the same controller.
- `AddTaskPanelShared.tsx`, `controls.tsx`, `styles.ts` — shared editor fields, action controls, floating menus, and style projections.
- `parsing.ts`, `due.ts`, `addTaskViewModel.ts`, `submitPayload.ts`, `formatDraftPreview.ts`, `descriptionLinksModel.ts` — pure parsing, recurrence/due, preview, dirty-state, description-link, and mutation-payload models.
- `todoistReminderModel.ts`, `applyTodoistReminderMutations.ts`, `TodoistReminderChips.tsx` — Todoist reminder anchoring, drafts, reconciliation, and controls.
- `todoistReferenceCache.ts` — independent five-minute project/label caches with shared in-flight requests and rejection invalidation.
- `submitAddTaskFlow.ts` — deadline-first create/update flow and non-fatal reminder reconciliation; retains the committed task across retry to prevent duplicate creates.
- `TodoistDuePicker.tsx` — anchored date/time picker layer.
- `types.ts` — frontend-only editor, parser, placement, and reminder-draft types; shared wire/domain contracts remain in `shared/types/`.

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Contracts

- Date-only Todoist reminders anchor at 9:00 AM Pacific; timed reminders anchor at the Pacific due time.
- Reminder preset/custom validation must continue blocking duplicates and past times, while sent reminders remain immutable.
- A saved deadline is never rolled back for reminder failures. Retry updates `committedTaskRef` instead of creating a duplicate task.
- Recurring natural-language input keeps the submit-time chrono warmup/reparse gate; manual due selection overrides parsed recurrence.
- Non-inline editors portal to `document.body`. Preserve anchored flip/clamp placement, mobile keyboard offset and scroll lock, due-picker-aware Escape handling, outside-click exclusions, and wheel containment.
- Inline and floating hosts share create/edit/delete payload semantics, including sending `labelIds: []` when an edit clears every label.

## Related

- `src/components/todoist/AddTaskPanel.tsx` — public component boundary.
- `shared/types/tasks.ts` / `shared/types/reminders.ts` — normalized task and persisted reminder contracts.
- `server/tasks/` — Todoist mirror, mutation, tombstone, and reminder backend.
