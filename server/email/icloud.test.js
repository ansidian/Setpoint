import { describe, it, expect, vi, beforeEach } from "vitest";

let activeClient;

class FakeImapFlow {
  constructor() {
    activeClient = this;
    this.usable = true;
    this.connect = vi.fn(async () => {});
    this.on = vi.fn();
    this.getMailboxLock = vi.fn(async () => ({ release: vi.fn() }));
    this.search = vi.fn(async () => [11, 12]);
    this.fetch = vi.fn(async function* () {
      yield {
        uid: 11,
        envelope: {
          date: new Date("2026-05-01T15:00:00Z"),
          from: [{ name: "Sender", address: "sender@example.com" }],
          subject: "iCloud range message",
        },
        flags: new Set(["\\Seen"]),
        source: Buffer.from("Header: value\r\n\r\nFull iCloud body $45.67"),
      };
      yield {
        uid: 12,
        envelope: {
          date: new Date("2026-05-03T15:00:00Z"),
          from: [{ address: "late@example.com" }],
          subject: "Outside range",
        },
        flags: new Set(),
        source: Buffer.from("Header: value\r\n\r\nOutside"),
      };
    });
  }
}

vi.mock("imapflow", () => ({ ImapFlow: FakeImapFlow }));

const { fetchEmailsInRange } = await import("./icloud.js");

describe("iCloud fetchEmailsInRange", () => {
  const fakeAccount = {
    id: "icloud-main",
    label: "iCloud",
    email: "me@icloud.com",
    color: "#abcdef",
    icon: "Apple",
  };

  beforeEach(() => {
    activeClient = null;
  });

  it("fetches a bounded INBOX date window and returns normalized indexable emails", async () => {
    const result = await fetchEmailsInRange(fakeAccount, "app-password", {
      start: "2026-04-25T00:00:00Z",
      end: "2026-05-02T00:00:00Z",
      limit: 25,
    });

    expect(activeClient.getMailboxLock).toHaveBeenCalledWith("INBOX");
    expect(activeClient.search).toHaveBeenCalledWith({
      since: new Date("2026-04-25T00:00:00Z"),
      before: new Date("2026-05-02T00:00:00Z"),
    });
    expect(activeClient.fetch).toHaveBeenCalledWith([11, 12], {
      envelope: true,
      flags: true,
      bodyStructure: true,
      source: { start: 0, maxLength: 262144 },
    });
    expect(result).toEqual({
      emails: [
        expect.objectContaining({
          uid: "icloud-11",
          account_id: "icloud-main",
          account_label: "iCloud",
          account_email: "me@icloud.com",
          from: "Sender",
          from_email: "sender@example.com",
          subject: "iCloud range message",
          body_preview: "Full iCloud body $45.67 [amounts: $45.67]",
          body_text: "Full iCloud body $45.67",
          date: "2026-05-01T15:00:00.000Z",
          read: true,
        }),
      ],
      cursor: null,
    });
  });
});
