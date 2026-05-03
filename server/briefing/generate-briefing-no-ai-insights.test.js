import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = { execute: vi.fn() };
const mockClaude = vi.hoisted(() => ({
  callClaude: vi.fn(),
}));

vi.mock("../db/connection.js", () => ({ default: mockDb }));
vi.mock("./encryption.js", () => ({ encrypt: (v) => v, decrypt: (v) => v }));
vi.mock("./gmail.js", () => ({
  fetchEmails: async () => [
    {
      id: "gmail-1",
      uid: "gmail-1",
      account_id: "acct-1",
      account_label: "Personal",
      account_email: "me@example.com",
      from: "Alex",
      subject: "Decision needed",
      snippet: "Can you approve this today?",
      date: "2026-05-03T15:00:00.000Z",
      read: false,
    },
  ],
}));
vi.mock("./icloud.js", () => ({ fetchEmails: async () => [] }));
vi.mock("./calendar.js", () => ({
  fetchCalendar: async () => [],
  getNextWeekRange: () => [0, 0],
  getTomorrowRange: () => [0, 0],
}));
vi.mock("./weather.js", () => ({
  fetchWeather: async () => ({ temp: 70, high: 75, low: 60, summary: "clear", hourly: [] }),
}));
vi.mock("./ctm.js", () => ({ fetchCTMDeadlines: async () => [] }));
vi.mock("./todoist.js", () => ({
  fetchTodoistTasks: async () => [],
  fetchTodoistTaskIdSet: async () => new Set(),
}));
vi.mock("./claude.js", () => mockClaude);
vi.mock("./actual.js", () => ({
  getCategories: async () => [],
  getUpcomingBills: async () => [],
}));
vi.mock("./email-index.js", () => ({
  indexEmails: async () => {},
  isIndexEmpty: async () => false,
  queueEmailIndexBackfill: async () => ({ queued: true }),
}));
vi.mock("./tombstones.js", () => ({ hydrateRecurringTombstones: async () => [] }));

const { generateBriefing } = await import("./index.js");

const USER_ID = "u1";

function stubDb() {
  mockDb.execute.mockImplementation(async (arg) => {
    const sql = typeof arg === "string" ? arg : arg.sql;
    if (sql.startsWith("INSERT INTO ea_briefings")) return { lastInsertRowid: 777n, rows: [] };
    if (sql.includes("SELECT * FROM ea_accounts")) {
      return {
        rows: [
          {
            id: "acct-1",
            user_id: USER_ID,
            type: "gmail",
            label: "Personal",
            icon: "Mail",
            color: "#cba6da",
            credentials_encrypted: "{}",
          },
        ],
      };
    }
    if (sql.includes("SELECT * FROM ea_settings")) {
      return { rows: [{ user_id: USER_ID, email_lookback_hours: 16, weather_location: "El Monte, CA" }] };
    }
    if (sql.includes("FROM ea_briefings") && sql.includes("ORDER BY generated_at DESC LIMIT 1")) {
      return { rows: [] };
    }
    if (sql.includes("FROM ea_dismissed_emails")) return { rows: [] };
    if (sql.includes("FROM ea_pinned_emails")) return { rows: [] };
    if (sql.includes("FROM ea_completed_tasks")) return { rows: [] };
    if (sql.startsWith("UPDATE ea_briefings")) return { rowsAffected: 1, rows: [] };
    return { rows: [] };
  });
}

describe("generateBriefing without AI insights or embeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDb();
    mockClaude.callClaude.mockResolvedValue({
      aiInsights: [{ text: "Generated trend prose should not be visible." }],
      emails: {
        summary: "One email needs attention.",
        accounts: [
          {
            name: "Personal",
            icon: "Mail",
            color: "#cba6da",
            important: [{ id: "gmail-1", subject: "Decision needed", read: false }],
            noise: [],
            noise_count: 0,
            unread: 1,
          },
        ],
      },
    });
  });

  it("does not inject historical context, write embeddings, or persist visible AI insights", async () => {
    const result = await generateBriefing(USER_ID);

    expect(mockClaude.callClaude).toHaveBeenCalledWith(
      expect.not.objectContaining({ historicalContext: expect.anything() }),
    );
    expect(result.briefingJson.aiInsights).toEqual([]);
    expect(result.briefingJson.ragUnavailable).toBeUndefined();
    const sqlCalls = mockDb.execute.mock.calls
      .map(([arg]) => (typeof arg === "string" ? arg : arg.sql))
      .join("\n");
    expect(sqlCalls).not.toMatch(/ea_embeddings/i);
  });
});
