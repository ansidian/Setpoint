import { describe, expect, it } from "vitest";
import { reconcileBriefingReadStatus } from "./briefing-email-state.js";

function makeBriefing() {
  return {
    emails: {
      accounts: [{
        name: "Personal",
        unread: 1,
        important: [{ id: "important-1", uid: "important-1", read: false }],
        noise: [{ id: "noise-1", uid: "noise-1", read: false }],
      }],
    },
  };
}

describe("reconcileBriefingReadStatus", () => {
  it("updates both important and noise rows while unread tracks only important", () => {
    const briefing = makeBriefing();

    const updated = reconcileBriefingReadStatus(briefing, {
      "important-1": true,
      "noise-1": true,
    });

    expect(updated.emails.accounts[0].important[0].read).toBe(true);
    expect(updated.emails.accounts[0].noise[0].read).toBe(true);
    expect(updated.emails.accounts[0].unread).toBe(0);
  });

  it("flipping only a noise row leaves unread unchanged (recomputed from important alone)", () => {
    const briefing = makeBriefing();

    const updated = reconcileBriefingReadStatus(briefing, {
      "noise-1": true,
    });

    // The noise row's read state flips...
    expect(updated.emails.accounts[0].noise[0].read).toBe(true);
    // ...but unread is recomputed from the important lane only, which is untouched.
    expect(updated.emails.accounts[0].important[0].read).toBe(false);
    expect(updated.emails.accounts[0].unread).toBe(1);
  });

  it("returns the same briefing reference for a no-op status (caller skips re-render)", () => {
    const briefing = makeBriefing();

    // Status keys match existing rows, but the read values already match.
    const result = reconcileBriefingReadStatus(briefing, {
      "important-1": false,
      "noise-1": false,
    });

    expect(Object.is(result, briefing)).toBe(true);
  });

  it("matches rows by uid, falling back to id only when uid is absent", () => {
    const briefing = {
      emails: {
        accounts: [{
          name: "Personal",
          unread: 1,
          important: [{ id: "id-A", uid: "uid-A", read: false }],
          noise: [],
        }],
      },
    };

    // Keying by the distinct uid flips the row...
    const byUid = reconcileBriefingReadStatus(briefing, { "uid-A": true });
    expect(byUid.emails.accounts[0].important[0].read).toBe(true);
    expect(byUid.emails.accounts[0].unread).toBe(0);

    // ...while keying by the id (when uid is present) does not match: no change.
    const byId = reconcileBriefingReadStatus(briefing, { "id-A": true });
    expect(Object.is(byId, briefing)).toBe(true);
  });

  it("returns the input unchanged for an empty status", () => {
    const briefing = makeBriefing();

    expect(Object.is(reconcileBriefingReadStatus(briefing, {}), briefing)).toBe(true);
    expect(Object.is(reconcileBriefingReadStatus(briefing), briefing)).toBe(true);
  });

  it("returns the input unchanged when accounts are missing", () => {
    const noAccounts = { emails: {} };
    expect(
      Object.is(reconcileBriefingReadStatus(noAccounts, { "important-1": true }), noAccounts),
    ).toBe(true);

    const noEmails = {};
    expect(
      Object.is(reconcileBriefingReadStatus(noEmails, { "important-1": true }), noEmails),
    ).toBe(true);

    expect(reconcileBriefingReadStatus(null, { "important-1": true })).toBe(null);
  });
});
