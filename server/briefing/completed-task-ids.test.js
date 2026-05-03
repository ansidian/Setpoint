import { describe, it, expect, vi } from "vitest";

const mockDb = { execute: vi.fn() };
vi.mock("../db/connection.js", () => ({ default: mockDb }));
vi.mock("./encryption.js", () => ({ decrypt: () => "mocked" }));
vi.mock("./gmail.js", () => ({ fetchEmails: async () => [] }));
vi.mock("./icloud.js", () => ({ fetchEmails: async () => [] }));
vi.mock("./calendar.js", () => ({ fetchCalendar: async () => [] }));
vi.mock("./weather.js", () => ({ fetchWeather: async () => ({}) }));
vi.mock("./ctm.js", () => ({ fetchCTMDeadlines: async () => [] }));
vi.mock("./email-ai.js", () => ({ callEmailAiModel: async () => ({}) }));
vi.mock("./actual.js", () => ({ getCategories: async () => [] }));

const { loadCompletedTaskIds } = await import("./index.js");

describe("loadCompletedTaskIds", () => {
  it("returns only ids from legacy dedupe rows (due_date IS NULL)", async () => {
    mockDb.execute.mockReset();
    mockDb.execute.mockImplementation(async ({ sql }) => {
      if (sql.startsWith("SELECT")) {
        return { rows: [{ todoist_id: "legacy-1" }, { todoist_id: "legacy-2" }] };
      }
      return { rows: [] };
    });

    const ids = await loadCompletedTaskIds("user-1", []);
    expect(ids).toEqual(new Set(["legacy-1", "legacy-2"]));

    const selectCall = mockDb.execute.mock.calls.find(
      ([arg]) => arg.sql?.startsWith("SELECT"),
    );
    expect(selectCall[0].sql).toMatch(/due_date IS NULL/i);
  });

  it("reconciles un-completed tasks by removing only legacy rows, not tombstones", async () => {
    mockDb.execute.mockReset();
    mockDb.execute.mockImplementation(async ({ sql }) => {
      if (sql.startsWith("SELECT")) {
        return { rows: [{ todoist_id: "legacy-a" }] };
      }
      return { rows: [] };
    });

    const ids = await loadCompletedTaskIds("user-1", [{ id: "legacy-a" }]);
    expect(ids.has("legacy-a")).toBe(false);

    const deleteCall = mockDb.execute.mock.calls.find(
      ([arg]) => arg.sql?.startsWith("DELETE"),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall[0].sql).toMatch(/due_date IS NULL/i);
  });
});
