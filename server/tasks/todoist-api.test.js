import { describe, expect, it, vi } from "vitest";
import { fetchTodoistSyncResources } from "./todoist-api.js";

describe("fetchTodoistSyncResources", () => {
  it("uses Todoist's current v1 sync endpoint", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sync_token: "next" }),
    }));

    await fetchTodoistSyncResources({
      token: "todoist-token",
      syncToken: "*",
      resourceTypes: ["items", "projects", "labels"],
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.todoist.com/api/v1/sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer todoist-token",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }),
    );
  });

  it("sends the sync request with an AbortSignal", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sync_token: "next" }),
    }));

    await fetchTodoistSyncResources({
      token: "todoist-token",
      syncToken: "*",
      resourceTypes: ["items", "projects", "labels"],
      fetchFn,
    });

    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
