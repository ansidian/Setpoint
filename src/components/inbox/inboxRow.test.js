import { describe, expect, it } from "vitest";
import { buildInboxRow, mergeReadState } from "./inboxRow.js";

const account = { id: "acc-1", name: "Work", email: "work@example.com" };

describe("buildInboxRow", () => {
  it("normalizes divergent source field names into the canonical shape", () => {
    const row = buildInboxRow({
      from_name: "Dana",
      from_address: "dana@example.com",
      summary: "Needs your approval.",
      email_date: "2026-05-03T14:00:00.000Z",
    }, {
      uid: "msg-1",
      account,
    });

    expect(row).toMatchObject({
      id: "msg-1",
      uid: "msg-1",
      subject: "",
      from: "Dana",
      fromEmail: "dana@example.com",
      from_email: "dana@example.com",
      preview: "Needs your approval.",
      body_preview: "Needs your approval.",
      date: "2026-05-03T14:00:00.000Z",
      _accountKey: "acc-1",
      lane: null,
      _lane: null,
      _untriaged: false,
      _live: false,
      _activeSnapshot: false,
      _resurfaced: false,
      _resurfacedAt: null,
    });
    expect(row._account).toBe(account);
    expect(row.from === "Unknown").toBe(false);
  });

  it("falls back to Unknown sender and preserves raw lane by default", () => {
    const row = buildInboxRow({ lane: "fyi" }, { uid: "msg-2", account });
    expect(row.from).toBe("Unknown");
    expect(row.lane).toBe("fyi");
  });

  it("merges the session read override exactly once, in both directions", () => {
    const base = { read: false };
    expect(buildInboxRow(base, { uid: "u", account, readOverrides: { u: true } }).read).toBe(true);
    expect(buildInboxRow({ read: true }, { uid: "u", account, readOverrides: { u: false } }).read).toBe(false);
    expect(buildInboxRow(base, { uid: "u", account }).read).toBe(false);
  });

  it("forces read for arrival-grace rows regardless of overrides", () => {
    const row = buildInboxRow({ read: false }, {
      uid: "u",
      account,
      forceRead: true,
      readOverrides: { u: false },
    });
    expect(row.read).toBe(true);
  });

  it("applies source extras after the canonical fields", () => {
    const row = buildInboxRow({ subject: "Hi" }, {
      uid: "u",
      account,
      extras: { account_label: "Work", urgentFlag: { label: "High" }, _carryover: true },
    });
    expect(row.account_label).toBe("Work");
    expect(row.urgentFlag).toEqual({ label: "High" });
    expect(row._carryover).toBe(true);
  });
});

describe("mergeReadState", () => {
  it("supports both Map and plain-object overrides", () => {
    expect(mergeReadState(false, "u", new Map([["u", true]]))).toBe(true);
    expect(mergeReadState(true, "u", { u: false })).toBe(false);
    expect(mergeReadState(true, "u", {})).toBe(true);
    expect(mergeReadState(false, null, { u: true })).toBe(false);
  });
});
