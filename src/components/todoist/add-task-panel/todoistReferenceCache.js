import * as api from "../../../api.js";

const TODOIST_REFERENCE_TTL_MS = 5 * 60 * 1000;

const cache = {
  projects: null,
  labels: null,
};

function getCachedReferenceData(key, fetchReferenceData) {
  const now = Date.now();
  const cached = cache[key];
  if (cached && (cached.at === null || now - cached.at < TODOIST_REFERENCE_TTL_MS)) {
    return cached.promise;
  }

  const entry = {
    promise: null,
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

export function getCachedTodoistProjects() {
  return getCachedReferenceData("projects", api.getTodoistProjects);
}

export function getCachedTodoistLabels() {
  return getCachedReferenceData("labels", api.getTodoistLabels);
}

export function invalidateTodoistReferenceCache() {
  cache.projects = null;
  cache.labels = null;
}
