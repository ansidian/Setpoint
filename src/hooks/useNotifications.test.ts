import { describe, it, expect } from "vitest";
import { calendarNotificationKey } from "./useNotifications";

describe("calendarNotificationKey", () => {
  it("produces different keys for same-titled events at the same start with different ids", () => {
    const keyA = calendarNotificationKey({ id: "event-a", title: "1:1", startMs: 1000 });
    const keyB = calendarNotificationKey({ id: "event-b", title: "1:1", startMs: 1000 });

    expect(keyA).not.toBe(keyB);
  });

  it("produces a stable key across calls for the same event object", () => {
    const event = { id: "event-a", title: "1:1", startMs: 1000 };

    expect(calendarNotificationKey(event)).toBe(calendarNotificationKey(event));
  });

  it("falls back to a title+startMs-only key when the event has no id, still distinct from a keyed event", () => {
    const idlessKey = calendarNotificationKey({ title: "1:1", startMs: 1000 });
    const keyedKey = calendarNotificationKey({ id: "event-a", title: "1:1", startMs: 1000 });

    expect(idlessKey).toBe("|1:1|1000");
    expect(idlessKey).not.toBe(keyedKey);
  });
});
