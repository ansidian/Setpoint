import { beforeEach, describe, expect, it } from "vitest";
import {
  _clearAlfredConversationsForTest,
  cacheAlfredItems,
  createAlfredConversation,
  deleteAlfredConversation,
  getAlfredConversation,
  readAlfredItems,
  sweepAlfredConversations,
} from "./alfred-conversations.js";

const HOUR = 60 * 60 * 1000;

describe("alfred conversation store", () => {
  beforeEach(() => {
    _clearAlfredConversationsForTest();
  });

  it("creates a conversation with an id, empty transcript, and empty item cache", () => {
    const conversation = createAlfredConversation({ now: 1000 });
    expect(conversation.id).toBeTruthy();
    expect(conversation.messages).toEqual([]);
    expect(getAlfredConversation(conversation.id, { now: 1000 })).toBe(conversation);
  });

  it("expires conversations past the TTL", () => {
    const conversation = createAlfredConversation({ now: 0 });
    expect(getAlfredConversation(conversation.id, { now: 5 * HOUR })).toBeNull();
  });

  it("touch on read extends the TTL", () => {
    const conversation = createAlfredConversation({ now: 0 });
    getAlfredConversation(conversation.id, { now: 3 * HOUR });
    expect(getAlfredConversation(conversation.id, { now: 6 * HOUR })).toBe(conversation);
  });

  it("deletes on demand", () => {
    const conversation = createAlfredConversation({ now: 0 });
    deleteAlfredConversation(conversation.id);
    expect(getAlfredConversation(conversation.id, { now: 0 })).toBeNull();
  });

  it("caches and reads items by kind and id, reporting unknown ids", () => {
    const conversation = createAlfredConversation({ now: 0 });
    cacheAlfredItems(conversation, "email", [{ uid: "a", subject: "Hello" }], "uid");
    cacheAlfredItems(conversation, "bill", [{ id: "b1", amount: 42 }]);

    expect(readAlfredItems(conversation, "email", ["a"])).toEqual({
      found: [{ uid: "a", subject: "Hello" }],
      missing: [],
    });
    expect(readAlfredItems(conversation, "bill", ["b1", "nope"])).toEqual({
      found: [{ id: "b1", amount: 42 }],
      missing: ["nope"],
    });
    expect(readAlfredItems(conversation, "email", ["b1"]).found).toEqual([]);
  });

  it("sweep removes only expired conversations", () => {
    const old = createAlfredConversation({ now: 0 });
    const fresh = createAlfredConversation({ now: 4 * HOUR });
    sweepAlfredConversations({ now: 5 * HOUR });
    expect(getAlfredConversation(old.id, { now: 5 * HOUR })).toBeNull();
    expect(getAlfredConversation(fresh.id, { now: 5 * HOUR })).toBe(fresh);
  });
});
