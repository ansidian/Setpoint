import { describe, expect, it } from "vitest";
import { resolveAlfredChipAction } from "./alfredChipActionModel.js";

describe("resolveAlfredChipAction", () => {
  it("maps an email chip to an email preview action", () => {
    const item = { uid: "m1", subject: "Renewal", from: { name: "Mercury" } };
    expect(resolveAlfredChipAction("email", item)).toEqual({ type: "email", item });
  });

  it("returns null for an email chip without a uid", () => {
    expect(resolveAlfredChipAction("email", { subject: "x" })).toBeNull();
  });

  it("maps an event chip to a calendar request focused on the Pacific day", () => {
    // 2026-06-13T03:00:00Z is 2026-06-12 8:00 PM Pacific (PDT, UTC-7)
    const item = { id: "e1", title: "Dentist", startMs: Date.UTC(2026, 5, 13, 3) };
    const action = resolveAlfredChipAction("event", item);
    expect(action.type).toBe("calendar");
    expect(action.request).toEqual({
      viewKey: "events",
      focusDate: "2026-06-12",
      focusItemId: "e1",
      options: { source: "alfred", openDetail: true, forceEventOverlay: true },
    });
  });

  it("degrades to a null focusDate when an event has no startMs", () => {
    const action = resolveAlfredChipAction("event", { id: "e1", title: "Dentist" });
    expect(action.request.focusDate).toBeNull();
    expect(action.request.focusItemId).toBe("e1");
  });

  it("maps a deadline chip through the dashboard occurrence builder", () => {
    const action = resolveAlfredChipAction("deadline", {
      id: "d1", content: "Renew registration", due_date: "2026-06-15", completed: false,
    });
    expect(action.type).toBe("calendar");
    expect(action.request.viewKey).toBe("events");
    expect(action.request.focusDate).toBe("2026-06-15");
    expect(action.request.focusItemId).toBe("deadline:d1:2026-06-15");
    expect(action.request.options.openDetail).toBe(true);
    expect(action.request.options.forceDeadlineOverlay).toBe(true);
  });

  it("maps a bill chip to the bills view focused on its next date", () => {
    const action = resolveAlfredChipAction("bill", {
      id: "b1", name: "Rent", next_date: "2026-06-14", paid: false,
    });
    expect(action.request).toEqual({
      viewKey: "bills",
      focusDate: "2026-06-14",
      focusItemId: "b1",
      options: { source: "dashboard", openDetail: true },
    });
  });

  it("returns null for missing items, missing ids, and unknown kinds", () => {
    expect(resolveAlfredChipAction("event", null)).toBeNull();
    expect(resolveAlfredChipAction("event", { title: "no id" })).toBeNull();
    expect(resolveAlfredChipAction("deadline", {})).toBeNull();
    expect(resolveAlfredChipAction("bill", {})).toBeNull();
    expect(resolveAlfredChipAction("transaction", { id: "x" })).toBeNull();
  });
});
