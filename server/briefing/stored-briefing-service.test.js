import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = { execute: vi.fn() };
vi.mock("../db/connection.js", () => ({ default: mockDb }));

const {
  markEmailsRead,
  markEmailsUnread,
  removeDismissedEmailFromBriefing,
  applyTaskCompletion,
  applyCTMStatusChange,
  applyCTMCompletionAfterTodoistClose,
  upsertTodoistTask,
  removeTodoistTask,
  mergeAccountPrefs,
} = await import("./stored-briefing-service.js");

function seedLatest(briefing, id = 1) {
  mockDb.execute.mockResolvedValueOnce({
    rows: [{ id, briefing_json: JSON.stringify(briefing) }],
  });
}

function captureUpdate() {
  // Second execute() call is the UPDATE; capture args
  mockDb.execute.mockResolvedValueOnce({ rowsAffected: 1 });
}

function getUpdatedBriefing() {
  const updateCall = mockDb.execute.mock.calls.find(
    (c) => c[0].sql?.startsWith("UPDATE ea_briefings SET briefing_json")
  );
  if (!updateCall) return null;
  return JSON.parse(updateCall[0].args[0]);
}

beforeEach(() => {
  mockDb.execute.mockReset();
});

describe("markEmailsRead", () => {
  it("flips email.read=true for matching uids and persists", async () => {
    seedLatest({
      emails: { accounts: [{ important: [{ id: "gmail-x-1", read: false }], unread: 1 }] },
    });
    captureUpdate();

    await markEmailsRead("u1", "gmail-x-1");

    const acct = getUpdatedBriefing().emails.accounts[0];
    expect(acct.important[0].read).toBe(true);
    expect(acct.unread).toBe(0);
  });

  it("is a no-op (no UPDATE) when no emails match", async () => {
    seedLatest({
      emails: { accounts: [{ important: [{ id: "gmail-x-1", read: true }] }] },
    });

    await markEmailsRead("u1", "gmail-missing");

    const updateCalls = mockDb.execute.mock.calls.filter(
      (c) => c[0].sql?.startsWith("UPDATE")
    );
    expect(updateCalls).toHaveLength(0);
  });

  it("matches by email.uid as well as email.id", async () => {
    seedLatest({
      emails: { accounts: [{ important: [{ uid: "icloud-7", read: false }] }] },
    });
    captureUpdate();

    await markEmailsRead("u1", ["icloud-7"]);

    expect(getUpdatedBriefing().emails.accounts[0].important[0].read).toBe(true);
  });

  it("updates matching noise rows without changing unread count", async () => {
    seedLatest({
      emails: {
        accounts: [{
          important: [{ id: "gmail-important", read: false }],
          noise: [{ uid: "gmail-noise", read: false }],
          unread: 1,
        }],
      },
    });
    captureUpdate();

    await markEmailsRead("u1", ["gmail-noise"]);

    const acct = getUpdatedBriefing().emails.accounts[0];
    expect(acct.noise[0].read).toBe(true);
    expect(acct.unread).toBe(1);
  });
});

describe("markEmailsUnread", () => {
  it("flips email.read=false and persists", async () => {
    seedLatest({
      emails: { accounts: [{ important: [{ id: "gmail-x-1", read: true }], unread: 0 }] },
    });
    captureUpdate();

    await markEmailsUnread("u1", ["gmail-x-1"]);

    const acct = getUpdatedBriefing().emails.accounts[0];
    expect(acct.important[0].read).toBe(false);
    expect(acct.unread).toBe(1);
  });

  it("updates matching noise rows without changing unread count", async () => {
    seedLatest({
      emails: {
        accounts: [{
          important: [{ id: "gmail-important", read: true }],
          noise: [{ uid: "gmail-noise", read: true }],
          unread: 0,
        }],
      },
    });
    captureUpdate();

    await markEmailsUnread("u1", ["gmail-noise"]);

    const acct = getUpdatedBriefing().emails.accounts[0];
    expect(acct.noise[0].read).toBe(false);
    expect(acct.unread).toBe(0);
  });
});

describe("removeDismissedEmailFromBriefing", () => {
  it("removes the matching email and updates unread count", async () => {
    seedLatest({
      emails: {
        accounts: [
          {
            important: [
              { id: "e1", read: false },
              { id: "e2", read: false },
            ],
            unread: 2,
          },
        ],
      },
    });
    captureUpdate();

    await removeDismissedEmailFromBriefing("u1", "e1");

    const acct = getUpdatedBriefing().emails.accounts[0];
    expect(acct.important.map((e) => e.id)).toEqual(["e2"]);
    expect(acct.unread).toBe(1);
  });
});

describe("applyTaskCompletion", () => {
  it("returns null without DB writes for recurring-Todoist (tombstone handles it)", async () => {
    await applyTaskCompletion("u1", {
      taskId: "td-1",
      isRecurringTodoist: true,
      isTodoistOnly: true,
    });
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("flips status=complete in place for Todoist-only non-recurring", async () => {
    seedLatest({
      todoist: {
        upcoming: [
          { id: "td-1", status: "incomplete", due_date: "2026-04-18" },
          { id: "td-2", status: "incomplete", due_date: "2026-04-18" },
        ],
        stats: {},
      },
    });
    captureUpdate();

    await applyTaskCompletion("u1", {
      taskId: "td-1",
      isRecurringTodoist: false,
      isTodoistOnly: true,
    });

    const upd = getUpdatedBriefing();
    expect(upd.todoist.upcoming.find((t) => t.id === "td-1").status).toBe("complete");
    expect(upd.todoist.stats.incomplete).toBe(1);
  });

  it("strips the task from ctm + todoist sections for CTM or CTM-linked completion", async () => {
    seedLatest({
      ctm: {
        upcoming: [
          { id: 42, todoist_id: "td-1", due_date: "2026-04-18" },
          { id: 43, due_date: "2026-04-18" },
        ],
      },
      todoist: {
        upcoming: [{ id: "td-1", due_date: "2026-04-18" }],
      },
    });
    captureUpdate();

    await applyTaskCompletion("u1", {
      taskId: "42",
      isRecurringTodoist: false,
      isTodoistOnly: false,
    });

    const upd = getUpdatedBriefing();
    expect(upd.ctm.upcoming.map((t) => t.id)).toEqual([43]);
    expect(upd.todoist.upcoming).toHaveLength(0);
  });
});

describe("upsertTodoistTask", () => {
  it("inserts a new task with default status=incomplete", async () => {
    seedLatest({ todoist: { upcoming: [], stats: {} } });
    captureUpdate();

    await upsertTodoistTask("u1", { id: "td-9", title: "New" }, { replace: false });

    const upd = getUpdatedBriefing();
    expect(upd.todoist.upcoming).toEqual([{ id: "td-9", title: "New", status: "incomplete" }]);
  });

  it("is a no-op when the task already exists and replace=false", async () => {
    seedLatest({
      todoist: { upcoming: [{ id: "td-9", title: "Old" }], stats: {} },
    });

    await upsertTodoistTask("u1", { id: "td-9", title: "New" }, { replace: false });

    const updateCalls = mockDb.execute.mock.calls.filter(
      (c) => c[0].sql?.startsWith("UPDATE")
    );
    expect(updateCalls).toHaveLength(0);
  });

  it("merges fields when replace=true", async () => {
    seedLatest({
      todoist: { upcoming: [{ id: "td-9", title: "Old", priority: 1 }], stats: {} },
    });
    captureUpdate();

    await upsertTodoistTask("u1", { id: "td-9", title: "New" }, { replace: true });

    const upd = getUpdatedBriefing();
    expect(upd.todoist.upcoming[0]).toMatchObject({ id: "td-9", title: "New", priority: 1 });
  });

  it("skips tombstone rows when matching by id", async () => {
    seedLatest({
      todoist: {
        upcoming: [{ id: "td-9", title: "Ghost", _tombstone: true }],
        stats: {},
      },
    });
    captureUpdate();

    await upsertTodoistTask("u1", { id: "td-9", title: "Live" }, { replace: false });

    const upd = getUpdatedBriefing();
    expect(upd.todoist.upcoming).toHaveLength(2); // tombstone preserved + new live row
    expect(upd.todoist.upcoming.find((t) => !t._tombstone).title).toBe("Live");
  });
});

describe("removeTodoistTask", () => {
  it("removes the live row and preserves tombstones with the same id", async () => {
    seedLatest({
      todoist: {
        upcoming: [
          { id: "td-9", title: "Live" },
          { id: "td-9", title: "Tomb", _tombstone: true },
        ],
        stats: {},
      },
    });
    captureUpdate();

    await removeTodoistTask("u1", "td-9");

    const upd = getUpdatedBriefing();
    expect(upd.todoist.upcoming).toHaveLength(1);
    expect(upd.todoist.upcoming[0]._tombstone).toBe(true);
  });
});

describe("applyCTMStatusChange", () => {
  it("sets status in place", async () => {
    seedLatest({
      ctm: { upcoming: [{ id: 42, status: "incomplete" }] },
    });
    captureUpdate();

    await applyCTMStatusChange("u1", "42", "in_progress");

    expect(getUpdatedBriefing().ctm.upcoming[0].status).toBe("in_progress");
  });
});

describe("applyCTMCompletionAfterTodoistClose", () => {
  it("removes CTM task and recomputes stats", async () => {
    seedLatest({
      ctm: {
        upcoming: [
          { id: 42, due_date: "2026-04-18" },
          { id: 43, due_date: "2026-04-18" },
        ],
        stats: {},
      },
    });
    captureUpdate();

    await applyCTMCompletionAfterTodoistClose("u1", "42");

    const upd = getUpdatedBriefing();
    expect(upd.ctm.upcoming.map((t) => t.id)).toEqual([43]);
    expect(upd.ctm.stats.incomplete).toBe(1);
  });
});

describe("email mutations with missing important field", () => {
  it("safely no-ops when an account lacks the important array", async () => {
    seedLatest({ emails: { accounts: [{ name: "Personal" }] } });
    await markEmailsRead("u1", "any-id");

    seedLatest({ emails: { accounts: [{ name: "Personal" }] } });
    await markEmailsUnread("u1", "any-id");

    seedLatest({ emails: { accounts: [{ name: "Personal" }] } });
    await removeDismissedEmailFromBriefing("u1", "any-id");

    const updateCalls = mockDb.execute.mock.calls.filter(
      (c) => c[0].sql?.startsWith("UPDATE")
    );
    expect(updateCalls).toHaveLength(0);
  });
});

describe("mergeAccountPrefs", () => {
  it("applies label/color/icon from ea_accounts by label or email match", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "a1", email: "x@y.com", label: "Personal", color: "#111", icon: "Mail" }],
    });
    const briefing = {
      emails: { accounts: [{ name: "x@y.com" }] },
    };

    const out = await mergeAccountPrefs(briefing, "u1");

    expect(out.emails.accounts[0]).toMatchObject({
      name: "Personal",
      color: "#111",
      icon: "Mail",
    });
  });

  it("is a no-op when briefing has no email accounts", async () => {
    const briefing = { emails: { accounts: [] } };
    const out = await mergeAccountPrefs(briefing, "u1");
    expect(out).toBe(briefing);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});
