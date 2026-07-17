import * as api from "../../../api";
import type { TodoistLabel, TodoistProject } from "../../../../shared/types/tasks";

const TODOIST_REFERENCE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  promise: Promise<T>;
  at: number | null;
}

const cache: {
  projects: CacheEntry<TodoistProject[]> | null;
  labels: CacheEntry<TodoistLabel[]> | null;
} = {
  projects: null,
  labels: null,
};

function getCachedReferenceData<K extends "projects" | "labels">(
  key: K,
  fetchReferenceData: () => Promise<K extends "projects" ? TodoistProject[] : TodoistLabel[]>,
) {
  const now = Date.now();
  const cached = cache[key];
  if (cached && (cached.at === null || now - cached.at < TODOIST_REFERENCE_TTL_MS)) {
    return cached.promise;
  }

  const entry: CacheEntry<K extends "projects" ? TodoistProject[] : TodoistLabel[]> = {
    promise: Promise.resolve([] as unknown as K extends "projects" ? TodoistProject[] : TodoistLabel[]),
    at: null,
  };
  entry.promise = fetchReferenceData().then(
    (value) => {
      entry.at = Date.now();
      return value;
    },
    (error) => {
      if (cache[key] === entry) cache[key] = null;
      throw error;
    },
  );
  cache[key] = entry;
  return entry.promise;
}

export function getCachedTodoistProjects(): Promise<TodoistProject[]> {
  return getCachedReferenceData<"projects">("projects", api.getTodoistProjects) as Promise<TodoistProject[]>;
}

export function getCachedTodoistLabels(): Promise<TodoistLabel[]> {
  return getCachedReferenceData<"labels">("labels", api.getTodoistLabels) as Promise<TodoistLabel[]>;
}

export function invalidateTodoistReferenceCache() {
  cache.projects = null;
  cache.labels = null;
}
