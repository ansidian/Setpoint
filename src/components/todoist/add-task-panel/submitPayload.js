export function buildDeadlineMutationPayload({
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
    title: parsed?.stripped ?? input.trim(),
  };

  if (description.trim()) payload.description = description.trim();
  if (resolvedProject) payload.projectId = resolvedProject.id;
  if (resolvedPriority) payload.priority = resolvedPriority;
  if (isEdit || resolvedLabels.length) {
    payload.labelIds = resolvedLabels.map((label) => label.name);
  }
  if (resolvedDue) payload.dueString = resolvedDue;

  return payload;
}
