import { afterEach, describe, expect, it, vi } from "vitest";

async function importDemoApi(now = "2026-05-12T15:30:00.000Z") {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "1");
  vi.stubGlobal("fetch", vi.fn());
  return import("../api");
}

describe("demo calendar API handlers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns an empty reminders list instead of an unhandled error (P3-16)", async () => {
    const api = await importDemoApi();

    expect(await api.listReminders({ sourceType: "calendar_event", sourceItemId: "demo-event-review" }))
      .toEqual({ reminders: [] });
    expect(await api.createReminder({
      sourceType: "calendar_event",
      sourceItemId: "demo-event-review",
      anchorKind: "event_start",
      anchorAt: "2026-05-12T17:00:00.000Z",
      offsetMinutes: 10,
    })).toMatchObject({ demo: true });
    expect(await api.deleteReminder("demo-reminder-1")).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates every clipboard-batch event and returns indexed created entries (P3-17)", async () => {
    const api = await importDemoApi();

    const before = (await api.getCalendarSearch({ scope: "events", q: "Batched demo" })).results.length;
    const result = await api.createCalendarEventsBatch([
      { title: "Batched demo alpha", startDate: "2026-05-14", startTime: "09:00", endDate: "2026-05-14", endTime: "09:30", calendarId: "demo-work" },
      { title: "Batched demo beta", startDate: "2026-05-15", startTime: "11:00", endDate: "2026-05-15", endTime: "11:30", calendarId: "demo-work" },
    ]);

    expect(result.failed).toEqual([]);
    expect(result.created).toHaveLength(2);
    expect(result.created.map((entry) => entry.index)).toEqual([0, 1]);
    expect(result.created[0]!.event).toMatchObject({ title: "Batched demo alpha" });
    expect(result.created[1]!.event).toMatchObject({ title: "Batched demo beta" });

    const after = (await api.getCalendarSearch({ scope: "events", q: "Batched demo" })).results.length;
    expect(after).toBe(before + 2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("places batch events on their Pacific calendar day so range fetches include them (P3-19)", async () => {
    const api = await importDemoApi();

    // 23:30 Pacific on 2026-05-14 is 06:30 UTC on 2026-05-15; the UTC-day filter
    // would drop it from a range ending 2026-05-14.
    await api.createCalendarEventsBatch([
      { title: "Late Pacific boundary demo", startDate: "2026-05-14", startTime: "23:30", endDate: "2026-05-14", endTime: "23:45", calendarId: "demo-work" },
    ]);

    const range = await api.getCalendarRange("2026-05-14", "2026-05-14");
    expect(range.events.some((event) => event.title === "Late Pacific boundary demo")).toBe(true);
  });

  it("reports place suggestions as an empty list rather than an unhandled error (P3-18)", async () => {
    const api = await importDemoApi();

    expect(await api.getCalendarPlaceSuggestions("coffee", "session-token")).toEqual({ places: [] });
    expect(await api.getCalendarPlaceDetails("demo-place-1", "session-token")).toEqual({ place: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not flag truncation when results land exactly on the limit (P3-20)", async () => {
    const api = await importDemoApi();

    // Empty query matches every seed event + deadline, giving a deterministic
    // total to pin the off-by-one boundary against.
    const full = await api.getCalendarSearch({ scope: "events", q: "", limit: 1000 });
    const total = full.results.length;
    expect(total).toBeGreaterThan(1);

    const exact = await api.getCalendarSearch({ scope: "events", q: "", limit: total });
    expect(exact.results).toHaveLength(total);
    expect(exact.truncated).toBe(false);

    const over = await api.getCalendarSearch({ scope: "events", q: "", limit: total - 1 });
    expect(over.results).toHaveLength(total - 1);
    expect(over.truncated).toBe(true);
  });
});
