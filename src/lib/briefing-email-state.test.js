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
});
