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

    expect(mockGetTodoistProjects).toHaveBeenCalledTimes(1);
    expect(mockGetTodoistLabels).toHaveBeenCalledTimes(1);
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
    expect(mockGetTodoistProjects).toHaveBeenCalledTimes(1);

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

    expect(mockGetTodoistProjects).toHaveBeenCalledTimes(2);
  });

  it("refetches both endpoints after explicit invalidation", async () => {
    mockGetTodoistProjects.mockResolvedValue([]);
    mockGetTodoistLabels.mockResolvedValue([]);

    await getCachedTodoistProjects();
    await getCachedTodoistLabels();
    invalidateTodoistReferenceCache();
    await getCachedTodoistProjects();
    await getCachedTodoistLabels();

    expect(mockGetTodoistProjects).toHaveBeenCalledTimes(2);
    expect(mockGetTodoistLabels).toHaveBeenCalledTimes(2);
  });

  it("refetches an endpoint after its five-minute TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
    mockGetTodoistProjects.mockResolvedValue([]);

    await getCachedTodoistProjects();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await getCachedTodoistProjects();

    expect(mockGetTodoistProjects).toHaveBeenCalledTimes(2);
  });
});
