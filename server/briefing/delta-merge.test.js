import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../db/connection.js", () => ({ default: {} }));
vi.mock("./encryption.js", () => ({ decrypt: () => "mocked" }));
vi.mock("./gmail.js", () => ({ fetchEmails: async () => [] }));
vi.mock("./icloud.js", () => ({ fetchEmails: async () => [] }));
vi.mock("./calendar.js", () => ({ fetchCalendar: async () => [] }));
vi.mock("./weather.js", () => ({ fetchWeather: async () => ({}) }));
vi.mock("./ctm.js", () => ({ fetchCTMDeadlines: async () => [] }));
vi.mock("./email-ai.js", () => ({ callEmailAiModel: async () => ({}) }));
vi.mock("./actual.js", () => ({ getCategories: async () => [] }));

const { mergeDeltaBriefing } = await import("./index.js");

// --- Fixtures ---
const prevBriefing = {
  emails: {
    accounts: [{
      name: "Gmail",
      important: [
        { id: "old1", from: "A", subject: "Old email 1", seenCount: 1, read: false },
        { id: "old2", from: "B", subject: "Old email 2", seenCount: 2, read: false },
        { id: "old3", from: "C", subject: "Old email 3 (expired)", seenCount: 3, read: true },
      ],
      noise_count: 5,
    }],
  },
};

const newBriefing = {
  emails: {
    accounts: [{
      name: "Gmail",
      important: [
        { id: "new1", from: "D", subject: "New email", read: true },
      ],
      noise_count: 2,
    }],
  },
};

const dismissedIds = new Set(["old2"]);
const allEmailIds = new Set(["old1", "old2", "old3", "new1"]);

describe("mergeDeltaBriefing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("new emails get seenCount 1", () => {
    const mergedAccounts = mergeDeltaBriefing(prevBriefing, newBriefing, dismissedIds, allEmailIds);
    const gmail = mergedAccounts.find((a) => a.name === "Gmail");
    const newEmail = gmail.important.find((e) => e.id === "new1");
    expect(newEmail).toBeDefined();
    expect(newEmail.seenCount).toBe(1);
  });

  it("carried-forward emails get seenCount incremented", () => {
    const mergedAccounts = mergeDeltaBriefing(prevBriefing, newBriefing, dismissedIds, allEmailIds);
    const gmail = mergedAccounts.find((a) => a.name === "Gmail");
    const old1 = gmail.important.find((e) => e.id === "old1");
    expect(old1).toBeDefined();
    expect(old1.seenCount).toBe(2); // was 1, incremented to 2
  });

  it("dismissed emails are filtered out", () => {
    const mergedAccounts = mergeDeltaBriefing(prevBriefing, newBriefing, dismissedIds, allEmailIds);
    const gmail = mergedAccounts.find((a) => a.name === "Gmail");
    const dismissed = gmail.important.find((e) => e.id === "old2");
    expect(dismissed).toBeUndefined();
  });

  it("emails no longer in inbox (not in allEmailIds) are filtered out", () => {
    const limitedIds = new Set(["new1"]); // old1 not in inbox anymore
    const mergedAccounts = mergeDeltaBriefing(prevBriefing, newBriefing, new Set(), limitedIds);
    const gmail = mergedAccounts.find((a) => a.name === "Gmail");
    const notInInbox = gmail.important.find((e) => e.id === "old1");
    expect(notInInbox).toBeUndefined();
  });

  it("emails with seenCount >= 3 are filtered out (expired)", () => {
    const mergedAccounts = mergeDeltaBriefing(prevBriefing, newBriefing, dismissedIds, allEmailIds);
    const gmail = mergedAccounts.find((a) => a.name === "Gmail");
    const expired = gmail.important.find((e) => e.id === "old3");
    expect(expired).toBeUndefined();
  });

  it("noise_count is summed for accounts with both old and new triage", () => {
    const mergedAccounts = mergeDeltaBriefing(prevBriefing, newBriefing, dismissedIds, allEmailIds);
    const gmail = mergedAccounts.find((a) => a.name === "Gmail");
    expect(gmail.noise_count).toBe(7); // 5 (prev) + 2 (new)
  });

  it("unread count tracks only unread important emails after merge", () => {
    const mergedAccounts = mergeDeltaBriefing(prevBriefing, newBriefing, dismissedIds, allEmailIds);
    for (const acct of mergedAccounts) {
      expect(acct.unread).toBe(acct.important.filter((email) => !email.read).length);
    }
  });

  it("accounts with only new emails (no previous triage) work correctly", () => {
    const prev = { emails: { accounts: [] } };
    const newB = {
      emails: {
        accounts: [{
          name: "iCloud",
          important: [{ id: "ic1", from: "X", subject: "Hi" }],
          noise_count: 0,
        }],
      },
    };
    const mergedAccounts = mergeDeltaBriefing(prev, newB, new Set(), new Set(["ic1"]));
    const icloud = mergedAccounts.find((a) => a.name === "iCloud");
    expect(icloud).toBeDefined();
    expect(icloud.important).toHaveLength(1);
    expect(icloud.important[0].seenCount).toBe(1);
  });

  it("accounts with only old emails carry forward correctly (no new triage for that account)", () => {
    const prev = {
      emails: {
        accounts: [{
          name: "iCloud",
          important: [{ id: "ic1", from: "X", subject: "Hi", seenCount: 1 }],
          noise_count: 3,
        }],
      },
    };
    const newB = {
      emails: {
        accounts: [],
      },
    };
    const mergedAccounts = mergeDeltaBriefing(prev, newB, new Set(), new Set(["ic1"]));
    const icloud = mergedAccounts.find((a) => a.name === "iCloud");
    expect(icloud).toBeDefined();
    expect(icloud.important[0].seenCount).toBe(2); // incremented
    expect(icloud.unread).toBe(1);
  });

  it("empty previous briefing (null) returns new briefing accounts with seenCount 1", () => {
    const mergedAccounts = mergeDeltaBriefing(null, newBriefing, new Set(), new Set(["new1"]));
    expect(mergedAccounts).toHaveLength(1);
    expect(mergedAccounts[0].name).toBe("Gmail");
    expect(mergedAccounts[0].important[0].seenCount).toBe(1);
  });

  it("duplicate email IDs between old and new triage — new wins (old filtered by existingEmailIds)", () => {
    const prev = {
      emails: {
        accounts: [{
          name: "Gmail",
          important: [{ id: "dup1", from: "OldSender", subject: "Old subject", seenCount: 1 }],
          noise_count: 0,
        }],
      },
    };
    const newB = {
      emails: {
        accounts: [{
          name: "Gmail",
          important: [{ id: "dup1", from: "NewSender", subject: "New subject" }],
          noise_count: 0,
        }],
      },
    };
    const mergedAccounts = mergeDeltaBriefing(prev, newB, new Set(), new Set(["dup1"]));
    const gmail = mergedAccounts.find((a) => a.name === "Gmail");
    // Only one copy of dup1 — the new one wins
    const dup1Emails = gmail.important.filter((e) => e.id === "dup1");
    expect(dup1Emails).toHaveLength(1);
    expect(dup1Emails[0].from).toBe("NewSender");
  });

  it("logs console.warn with [Briefing] tag when output count exceeds input count", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Verify warn is NOT called on normal inputs (no false positives)
    mergeDeltaBriefing(prevBriefing, newBriefing, dismissedIds, allEmailIds);
    const briefingWarnCalls = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("[Briefing]")
    );
    // Normal merge should NOT trigger the invariant warning
    expect(briefingWarnCalls).toHaveLength(0);
    warnSpy.mockRestore();
  });
});
