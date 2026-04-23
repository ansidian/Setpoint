import { describe, expect, it } from "vitest";
import {
  markBriefingAccountEmailsRead,
  reconcileBriefingReadStatus,
  setBriefingEmailReadState,
} from "./briefing-email-state.js";

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
});

describe("setBriefingEmailReadState", () => {
  it("updates a matching noise row without changing important unread counts", () => {
    const briefing = makeBriefing();

    const updated = setBriefingEmailReadState(briefing, "noise-1", true);

    expect(updated.emails.accounts[0].noise[0].read).toBe(true);
    expect(updated.emails.accounts[0].unread).toBe(1);
  });
});

describe("markBriefingAccountEmailsRead", () => {
  it("marks both important and noise rows read for the selected account", () => {
    const briefing = makeBriefing();

    const updated = markBriefingAccountEmailsRead(briefing, 0);

    expect(updated.emails.accounts[0].important[0].read).toBe(true);
    expect(updated.emails.accounts[0].noise[0].read).toBe(true);
    expect(updated.emails.accounts[0].unread).toBe(0);
  });
});
