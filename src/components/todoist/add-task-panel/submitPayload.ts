import type { DeadlineMutationRequest, TodoistPriority } from "../../../../shared/types/tasks";
import type { ParsedTodoistTokensInput, TodoistNamedReference } from "./types";

// The title the server actually receives: the input with resolved tokens
// (#project, @label, !priority, dates) stripped out. `parsed.stripped` is always
// a string, so this collapses to it whenever parsing has run.
export function effectiveTaskTitle({ parsed, input = "" }: { parsed?: ParsedTodoistTokensInput | null; input?: string }) {
  return (parsed?.stripped ?? input).trim();
}

// Submit is allowed only when the effective title is non-empty. Basing this on
// `parsed.stripped` (not raw input) prevents tokens-only input like "#Work @home"
// from firing a create the server rejects with a 400 for an empty title.
export function canSubmitTask({ parsed, input = "" }: { parsed?: ParsedTodoistTokensInput | null; input?: string }) {
  return effectiveTaskTitle({ parsed, input }).length > 0;
}

export function buildDeadlineMutationPayload({
  parsed,
  input = "",
  description = "",
  resolvedProject = null,
  resolvedPriority = null,
  resolvedLabels = [],
  resolvedDue = null,
  isEdit = false,
}: {
  parsed?: ParsedTodoistTokensInput | null;
  input?: string;
  description?: string;
  resolvedProject?: TodoistNamedReference | null;
  resolvedPriority?: TodoistPriority;
  resolvedLabels?: TodoistNamedReference[];
  resolvedDue?: string | null;
  isEdit?: boolean;
}): DeadlineMutationRequest {
  const payload: DeadlineMutationRequest = {
    // `||` (not `??`): a tokens-only input strips to "", which must fall back to
    // the raw input rather than being persisted as a blank title.
    title: parsed?.stripped || input.trim(),
  };

  if (description.trim()) payload.description = description.trim();
  if (resolvedProject?.id) payload.projectId = resolvedProject.id;
  if (resolvedPriority) payload.priority = resolvedPriority;
  if (isEdit || resolvedLabels.length) {
    payload.labelIds = resolvedLabels.map((label) => label.name);
  }
  if (resolvedDue) payload.dueString = resolvedDue;

  return payload;
}
