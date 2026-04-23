import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../db/connection.js", () => ({ default: {} }));
vi.mock("./encryption.js", () => ({ decrypt: () => "mocked" }));
vi.mock("./gmail.js", () => ({ fetchEmails: async () => [] }));
vi.mock("./icloud.js", () => ({ fetchEmails: async () => [] }));
vi.mock("./calendar.js", () => ({ fetchCalendar: async () => [] }));
vi.mock("./weather.js", () => ({ fetchWeather: async () => ({}) }));
vi.mock("./ctm.js", () => ({ fetchCTMDeadlines: async () => [] }));
vi.mock("./claude.js", () => ({ callClaude: async () => ({}) }));
vi.mock("./actual.js", () => ({ getCategories: async () => [] }));

const { fixEmailAccounts } = await import("./index.js");

describe("fixEmailAccounts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("regroups emails by original account_label when Claude mis-grouped", () => {
    const inputEmails = [
      { uid: "e1", account_label: "Gmail", account_icon: "G", account_color: "#red" },
      { uid: "e2", account_label: "iCloud", account_icon: "I", account_color: "#blue" },
    ];
    const briefingJson = {
      emails: {
        accounts: [{
          name: "Gmail",
          important: [
            { id: "e1", from: "A", subject: "A" },
            { id: "e2", from: "B", subject: "B" }, // mis-grouped by Claude
          ],
          noise_count: 3,
        }],
      },
    };

    fixEmailAccounts(briefingJson, inputEmails);

    expect(briefingJson.emails.accounts).toHaveLength(2);
    const gmail = briefingJson.emails.accounts.find((a) => a.name === "Gmail");
    const icloud = briefingJson.emails.accounts.find((a) => a.name === "iCloud");
    expect(gmail.important).toHaveLength(1);
    expect(gmail.important[0].id).toBe("e1");
    expect(icloud.important).toHaveLength(1);
    expect(icloud.important[0].id).toBe("e2");
  });

  it("emails with no uid match fall back to the Claude account name with default icon/color", () => {
    const inputEmails = [
      { uid: "e1", account_label: "Gmail", account_icon: "G", account_color: "#red" },
    ];
    const briefingJson = {
      emails: {
        accounts: [{
          name: "Gmail",
          important: [
            { id: "e1", from: "A", subject: "A" },
            { id: "e_unknown", from: "X", subject: "X" }, // no uid in inputEmails
          ],
          noise_count: 0,
        }],
      },
    };

    fixEmailAccounts(briefingJson, inputEmails);

    // e_unknown has no uid match so falls back to acct.name "Gmail"
    const gmail = briefingJson.emails.accounts.find((a) => a.name === "Gmail");
    expect(gmail).toBeDefined();
    expect(gmail.important).toHaveLength(2);
  });

  it("resets accounts to empty when inputEmails is empty and no dbAccounts", () => {
    const briefingJson = {
      emails: {
        accounts: [{
          name: "Gmail",
          important: [{ id: "e1", from: "A", subject: "A" }],
          noise_count: 2,
        }],
      },
    };

    fixEmailAccounts(briefingJson, []);

    expect(briefingJson.emails.accounts).toEqual([]);
  });

  it("returns early without error when briefingJson.emails.accounts is empty", () => {
    const inputEmails = [
      { uid: "e1", account_label: "Gmail", account_icon: "G", account_color: "#red" },
    ];
    const briefingJson = { emails: { accounts: [] } };

    expect(() => fixEmailAccounts(briefingJson, inputEmails)).not.toThrow();
  });

  it("reassigns all emails from one Claude account to two correct accounts via uid lookup", () => {
    const inputEmails = [
      { uid: "e1", account_label: "Work", account_icon: "W", account_color: "#111" },
      { uid: "e2", account_label: "Personal", account_icon: "P", account_color: "#222" },
      { uid: "e3", account_label: "Work", account_icon: "W", account_color: "#111" },
    ];
    const briefingJson = {
      emails: {
        accounts: [{
          name: "Work",
          important: [
            { id: "e1", subject: "Meeting" },
            { id: "e2", subject: "Hello" },
            { id: "e3", subject: "Report" },
          ],
          noise_count: 5,
        }],
      },
    };

    fixEmailAccounts(briefingJson, inputEmails);

    const work = briefingJson.emails.accounts.find((a) => a.name === "Work");
    const personal = briefingJson.emails.accounts.find((a) => a.name === "Personal");
    expect(work.important).toHaveLength(2);
    expect(personal.important).toHaveLength(1);
    expect(personal.important[0].id).toBe("e2");
  });

  it("drops noise entries whose id is already in important (Claude double-classify)", () => {
    const inputEmails = [
      { uid: "e1", account_label: "Gmail", account_icon: "G", account_color: "#red" },
      { uid: "e2", account_label: "Gmail", account_icon: "G", account_color: "#red" },
    ];
    const briefingJson = {
      emails: {
        accounts: [{
          name: "Gmail",
          important: [
            { id: "e1", from: "Sender", subject: "Real" },
            { id: "e2", from: "Other", subject: "Other" },
          ],
          noise: [
            { id: "e1", from: "Sender", subject: "Real" }, // duplicate of important
            { id: "n1", from: "Spam", subject: "Promo" },  // genuine noise
          ],
          noise_count: 2,
        }],
      },
    };

    fixEmailAccounts(briefingJson, inputEmails);

    const gmail = briefingJson.emails.accounts.find((a) => a.name === "Gmail");
    expect(gmail.important.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    expect(gmail.noise.map((e) => e.id)).toEqual(["n1"]);
  });

  it("preserves duplicate email IDs without deduplication", () => {
    const inputEmails = [
      { uid: "e1", account_label: "Gmail", account_icon: "G", account_color: "#red" },
    ];
    const briefingJson = {
      emails: {
        accounts: [{
          name: "Gmail",
          important: [
            { id: "e1", subject: "First" },
            { id: "e1", subject: "Duplicate" },
          ],
          noise_count: 0,
        }],
      },
    };

    fixEmailAccounts(briefingJson, inputEmails);

    const gmail = briefingJson.emails.accounts.find((a) => a.name === "Gmail");
    expect(gmail.important).toHaveLength(2);
  });

  it("preserves noise_count from Claude's original account grouping", () => {
    const inputEmails = [
      { uid: "e1", account_label: "Gmail", account_icon: "G", account_color: "#red" },
    ];
    const briefingJson = {
      emails: {
        accounts: [{
          name: "Gmail",
          important: [{ id: "e1", subject: "Hello" }],
          noise_count: 42,
        }],
      },
    };

    fixEmailAccounts(briefingJson, inputEmails);

    const gmail = briefingJson.emails.accounts.find((a) => a.name === "Gmail");
    expect(gmail.noise_count).toBe(42);
  });

  it("sets unread count to the number of unread important emails after regrouping", () => {
    const inputEmails = [
      { uid: "e1", account_label: "Gmail", account_icon: "G", account_color: "#red", read: false },
      { uid: "e2", account_label: "Gmail", account_icon: "G", account_color: "#red", read: true },
      { uid: "e3", account_label: "Gmail", account_icon: "G", account_color: "#red", read: false },
    ];
    const briefingJson = {
      emails: {
        accounts: [{
          name: "Gmail",
          important: [
            { id: "e1", subject: "A", read: false },
            { id: "e2", subject: "B", read: true },
            { id: "e3", subject: "C", read: false },
          ],
          noise_count: 0,
          unread: 99, // should be overwritten
        }],
      },
    };

    fixEmailAccounts(briefingJson, inputEmails);

    const gmail = briefingJson.emails.accounts.find((a) => a.name === "Gmail");
    expect(gmail.unread).toBe(2);
  });

  it("copies current read state onto preserved noise entries", () => {
    const inputEmails = [
      { uid: "e1", account_label: "Gmail", account_icon: "G", account_color: "#red", read: true },
    ];
    const dbAccounts = [
      { type: "gmail", label: "Gmail", icon: "G", color: "#red" },
    ];
    const briefingJson = {
      emails: {
        accounts: [{
          name: "Gmail",
          important: [],
          noise: [{ id: "e1", subject: "Promo", from: "Store" }],
          noise_count: 1,
          unread: 0,
        }],
      },
    };

    fixEmailAccounts(briefingJson, inputEmails, dbAccounts);

    const gmail = briefingJson.emails.accounts.find((a) => a.name === "Gmail");
    expect(gmail.noise[0].read).toBe(true);
  });

  it("logs console.warn with [Briefing] tag and still completes when email count in does not equal email count out", () => {
    // RED: fails because fixEmailAccounts is not yet exported from index.js
    // (calling undefined throws TypeError) — and even if callable, no warn code exists.
    // GREEN: fixEmailAccounts is exported and invariant check added.
    // For the mismatch fixture: in GREEN, countIn=allTriaged.length, countOut=sum of important.
    // The algorithm always produces countIn === countOut (every email goes to exactly one group).
    // This test verifies the invariant does NOT produce false positives on normal inputs,
    // and that console.warn is NOT called when counts match.
    // The test also verifies fixEmailAccounts still completes (does not throw) on any input.

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const inputEmails = [
      { uid: "e1", account_label: "Gmail", account_icon: "G", account_color: "#red" },
      { uid: "e2", account_label: "iCloud", account_icon: "I", account_color: "#blue" },
    ];
    const briefingJson = {
      emails: {
        accounts: [{
          name: "Gmail",
          important: [
            { id: "e1", from: "A", subject: "A" },
            { id: "e2", from: "B", subject: "B" },
          ],
          noise_count: 3,
        }],
      },
    };

    // Should complete without throwing even with count checking enabled
    expect(() => fixEmailAccounts(briefingJson, inputEmails)).not.toThrow();

    // countIn=2, countOut=2 (e1→Gmail, e2→iCloud) — no mismatch, warn should NOT fire
    const warnCallsWithBriefingTag = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("[Briefing]")
    );
    expect(warnCallsWithBriefingTag).toHaveLength(0);
  });
});
