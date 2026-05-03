import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = { execute: vi.fn() };

vi.mock("../db/connection.js", () => ({ default: mockDb }));
vi.mock("./encryption.js", () => ({ encrypt: (v) => v, decrypt: (v) => v }));
vi.mock("./gmail.js", () => ({ fetchEmails: async () => [] }));
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
vi.mock("./email-ai.js", () => ({ callEmailAiModel: async () => ({ emails: { accounts: [] } }) }));
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

// Shape-accurate prev briefing with carry-forward emails at seenCount=1.
// aiGeneratedAt must be recent so the !aiStale gate (16h window) lets skip-path
// fire; otherwise generateBriefing falls through to full AI regeneration.
function makePrevBriefing() {
  return {
    emails: {
      summary: "",
      accounts: [
        {
          name: "Business",
          icon: "Briefcase",
          color: "#000",
          important: [{ id: "b1", subject: "Invoice", seenCount: 1, read: false }],
          noise: [],
          noise_count: 0,
          unread: 1,
        },
        {
          name: "iCloud",
          icon: "Apple",
          color: "#aaa",
          important: [{ id: "i1", subject: "Hello", seenCount: 1, read: false }],
          noise: [],
          noise_count: 0,
          unread: 1,
        },
      ],
    },
    calendar: [],
    aiGeneratedAt: new Date().toISOString(),
    aiInsights: [],
  };
}

// Route the sequential db.execute calls generateBriefing issues on the skip path.
// The order matches the actual code flow; returning { rows, lastInsertRowid } as needed.
function stubDb({ prevBriefing, accounts, settings }) {
  const calls = [];
  mockDb.execute.mockImplementation(async (arg) => {
    const sql = typeof arg === "string" ? arg : arg.sql;
    calls.push(sql);

    if (sql.startsWith("INSERT INTO ea_briefings")) {
      return { lastInsertRowid: 777n, rows: [] };
    }
    if (sql.includes("SELECT * FROM ea_accounts")) {
      return { rows: accounts };
    }
    if (sql.includes("SELECT * FROM ea_settings")) {
      return { rows: [settings] };
    }
    if (sql.includes("FROM ea_briefings") && sql.includes("ORDER BY generated_at DESC LIMIT 1")) {
      return {
        rows: [{
          generated_at: new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 19).replace("T", " "),
          briefing_json: JSON.stringify(prevBriefing),
        }],
      };
    }
    if (sql.includes("FROM ea_dismissed_emails")) return { rows: [] };
    if (sql.includes("FROM ea_pinned_emails")) return { rows: [] };
    if (sql.includes("FROM ea_completed_tasks")) return { rows: [] };
    if (sql.startsWith("UPDATE ea_briefings")) return { rowsAffected: 1, rows: [] };
    return { rows: [] };
  });
  return calls;
}

describe("generateBriefing skip path", () => {
  beforeEach(() => {
    mockDb.execute.mockReset();
  });

  it("preserves carry-forward emails when the fresh fetch returns zero emails", async () => {
    // Reproduces the prod bug: quiet 4-hour window → fetchAllEmails = [] →
    // skip path → fixEmailAccounts' empty-inputs branch used to wipe accounts.
    // Guard at the call site must prevent the wipe so carry-forward survives.
    const prev = makePrevBriefing();
    const accounts = [
      { id: "gmail-1", user_id: USER_ID, type: "gmail", label: "Business", icon: "Briefcase", color: "#000", credentials_encrypted: "{}" },
      { id: "icloud-1", user_id: USER_ID, type: "icloud", label: "iCloud", icon: "Apple", color: "#aaa", credentials_encrypted: "p" },
    ];
    const settings = { email_lookback_hours: 16, weather_location: "El Monte, CA" };

    stubDb({ prevBriefing: prev, accounts, settings });

    await generateBriefing(USER_ID);

    const updateCall = mockDb.execute.mock.calls.find(
      ([arg]) => (typeof arg === "string" ? arg : arg.sql).includes("UPDATE ea_briefings SET status = 'ready'"),
    );
    expect(updateCall).toBeDefined();
    const savedJson = updateCall[0].args[0];
    const saved = JSON.parse(savedJson);

    expect(saved.skippedAI).toBe(true);
    expect(saved.emails.accounts).toHaveLength(2);

    const business = saved.emails.accounts.find((a) => a.name === "Business");
    const icloud = saved.emails.accounts.find((a) => a.name === "iCloud");
    expect(business.important).toHaveLength(1);
    expect(business.important[0].id).toBe("b1");
    expect(business.important[0].seenCount).toBe(2);
    expect(icloud.important).toHaveLength(1);
    expect(icloud.important[0].id).toBe("i1");
    expect(icloud.important[0].seenCount).toBe(2);
  });
});
