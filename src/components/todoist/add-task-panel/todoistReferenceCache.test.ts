import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetTodoistProjects, mockGetTodoistLabels } = vi.hoisted(() => ({
  mockGetTodoistProjects: vi.fn(),
  mockGetTodoistLabels: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- src/api.ts is the client/server Todoist boundary; cache tests control provider responses.
vi.mock("../../../api", () => ({
  getTodoistProjects: mockGetTodoistProjects,
  getTodoistLabels: mockGetTodoistLabels,
}));

import {
  getCachedTodoistLabels,
  getCachedTodoistProjects,
  invalidateTodoistReferenceCache,
} from "./todoistReferenceCache";

describe("Todoist reference cache", () => {
  beforeEach(() => {
    invalidateTodoistReferenceCache();
    mockGetTodoistProjects.mockReset();
    mockGetTodoistLabels.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses each endpoint's result for sequential calls within five minutes", async () => {
    const projects = [{ id: "project-1", name: "Inbox" }];
    const labels = [{ id: "label-1", name: "errands" }];
    mockGetTodoistProjects.mockResolvedValue(projects);
    mockGetTodoistLabels.mockResolvedValue(labels);

    await expect(getCachedTodoistProjects()).resolves.toBe(projects);
    await expect(getCachedTodoistProjects()).resolves.toBe(projects);
    await expect(getCachedTodoistLabels()).resolves.toBe(labels);
    await expect(getCachedTodoistLabels()).resolves.toBe(labels);

  });

  it("shares one in-flight request between concurrent callers", async () => {
    let resolveProjects: ((projects: Array<{ id: string; name: string }>) => void) | undefined;
    const projects = [{ id: "project-1", name: "Inbox" }];
    mockGetTodoistProjects.mockReturnValue(new Promise((resolve) => {
      resolveProjects = resolve;
    }));

    const first = getCachedTodoistProjects();
    const second = getCachedTodoistProjects();

    expect(second).toBe(first);

    resolveProjects!(projects);
    await expect(first).resolves.toBe(projects);
  });

  it("retries an endpoint after its cached request rejects", async () => {
    const projects = [{ id: "project-1", name: "Inbox" }];
    mockGetTodoistProjects
      .mockRejectedValueOnce(new Error("Todoist unavailable"))
      .mockResolvedValueOnce(projects);

    await expect(getCachedTodoistProjects()).rejects.toThrow("Todoist unavailable");
    await expect(getCachedTodoistProjects()).resolves.toBe(projects);

  });

  it("refetches both endpoints after explicit invalidation", async () => {
    mockGetTodoistProjects
      .mockResolvedValueOnce([{ id: "project-1", name: "Before" }])
      .mockResolvedValueOnce([{ id: "project-2", name: "After" }]);
    mockGetTodoistLabels
      .mockResolvedValueOnce([{ id: "label-1", name: "before" }])
      .mockResolvedValueOnce([{ id: "label-2", name: "after" }]);

    const projectsBefore = await getCachedTodoistProjects();
    const labelsBefore = await getCachedTodoistLabels();
    invalidateTodoistReferenceCache();
    const projectsAfter = await getCachedTodoistProjects();
    const labelsAfter = await getCachedTodoistLabels();

    expect(projectsBefore).toEqual([{ id: "project-1", name: "Before" }]);
    expect(projectsAfter).toEqual([{ id: "project-2", name: "After" }]);
    expect(labelsBefore).toEqual([{ id: "label-1", name: "before" }]);
    expect(labelsAfter).toEqual([{ id: "label-2", name: "after" }]);
  });

  it("refetches an endpoint after its five-minute TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
    mockGetTodoistProjects
      .mockResolvedValueOnce([{ id: "project-1", name: "Before" }])
      .mockResolvedValueOnce([{ id: "project-2", name: "After" }]);

    const beforeExpiry = await getCachedTodoistProjects();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const afterExpiry = await getCachedTodoistProjects();

    expect(beforeExpiry).toEqual([{ id: "project-1", name: "Before" }]);
    expect(afterExpiry).toEqual([{ id: "project-2", name: "After" }]);
  });
});
