export function buildTodoistTaskPayload({
  parsed,
  input = "",
  description = "",
  resolvedProject = null,
  resolvedPriority = null,
  resolvedLabels = [],
  resolvedDue = null,
  isEdit = false,
}) {
  const payload = {
    content: parsed?.stripped ?? input.trim(),
  };

  if (description.trim()) payload.description = description.trim();
  if (resolvedProject) payload.project_id = resolvedProject.id;
  if (resolvedPriority) payload.priority = resolvedPriority;
  if (isEdit || resolvedLabels.length) {
    payload.labels = resolvedLabels.map((label) => label.name);
  }
  if (resolvedDue) payload.due_string = resolvedDue;

  return payload;
}
