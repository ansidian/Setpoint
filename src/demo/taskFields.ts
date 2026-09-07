import type { TodoistProject } from "../../shared/types/tasks";
import type { DemoRequestBody } from "./apiHandler";

export const demoTodoistProjects: TodoistProject[] = [
  { id: "demo-project-inbox", name: "Inbox", isInbox: true, color: "#89b4fa" },
  { id: "demo-project-engineering", name: "Engineering", isInbox: false, color: "#a6e3a1" },
  { id: "demo-project-career", name: "Career", isInbox: false, color: "#f5c2e7" },
];

// The editor sends project IDs and label names; reads consume normalized task
// fields, just as the production Todoist mutation response does.
export function demoTaskFields(body: DemoRequestBody, creating = false) {
  const project = demoTodoistProjects.find((entry) => entry.id === body.projectId) || demoTodoistProjects[0]!;
  return {
    ...(creating || body.projectId !== undefined ? {
      class_name: project.name,
      project_name: project.name,
      class_color: project.color,
    } : {}),
    ...(creating || body.labelIds !== undefined ? {
      labels: Array.isArray(body.labelIds) ? body.labelIds.map(String) : [],
    } : {}),
  };
}
