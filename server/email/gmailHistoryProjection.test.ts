import { describe, expect, it } from "vitest";
import {
  collectInboxMessageIds,
  collectUnreadLabelMessageIds,
  collectProviderRemovalEvents,
  providerStateFromMetadata,
} from "./gmailHistoryProjection.ts";

describe("gmail history projection", () => {
  it("collectInboxMessageIds picks INBOX messagesAdded and labelsAdded", () => {
    expect(collectInboxMessageIds([
      { messagesAdded: [{ message: { id: "a", labelIds: ["INBOX"] } }, { message: { id: "b", labelIds: ["SENT"] } }] },
      { labelsAdded: [{ message: { id: "c" }, labelIds: ["INBOX"] }] },
    ])).toEqual(["a", "c"]);
  });

  it("collectUnreadLabelMessageIds picks UNREAD adds and removes", () => {
    expect(collectUnreadLabelMessageIds([
      { labelsAdded: [{ message: { id: "x" }, labelIds: ["UNREAD"] }] },
      { labelsRemoved: [{ message: { id: "y" }, labelIds: ["UNREAD"] }] },
      { labelsAdded: [{ message: { id: "z" }, labelIds: ["INBOX"] }] },
    ]).sort()).toEqual(["x", "y"]);
  });

  it("collectProviderRemovalEvents tags inbox_removed/trash_added/message_deleted", () => {
    const events = collectProviderRemovalEvents([
      { labelsRemoved: [{ message: { id: "x" }, labelIds: ["INBOX"] }], labelsAdded: [{ message: { id: "y" }, labelIds: ["TRASH"] }], messagesDeleted: [{ message: { id: "z" } }] },
    ]);
    expect([...events.get("x")!]).toEqual(["inbox_removed"]);
    expect([...events.get("y")!]).toEqual(["trash_added"]);
    expect([...events.get("z")!]).toEqual(["message_deleted"]);
  });

  it("providerStateFromMetadata maps TRASH/archived/inbox/null", () => {
    expect(providerStateFromMetadata({ labelIds: ["TRASH"] })).toBe("trashed");
    expect(providerStateFromMetadata({ labelIds: [] })).toBe("archived");
    expect(providerStateFromMetadata({ labelIds: ["INBOX"] })).toBe(null);
    expect(providerStateFromMetadata(null)).toBe(null);
  });
});
