import { afterEach, describe, expect, it, vi } from "vitest";

describe("Time to Leave demo API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("persists a grounded in-memory dynamic reminder without network access", async () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    let networkAttempted = false;
    vi.stubGlobal("fetch", () => {
      networkAttempted = true;
      throw new Error("Demo mode reached fetch");
    });
    const api = await import("./api.ts");

    await expect(api.createReminder({
      reminderKind: "time_to_leave",
      sourceType: "calendar_event",
      sourceAccountId: "demo-gmail",
      sourceCalendarId: "demo-work",
      sourceItemId: "demo-event-review",
      eventStart: "2099-05-12T17:00:00.000Z",
      eventLocation: "500 Demo Way",
      arrivalBufferMinutes: 15,
    })).resolves.toMatchObject({
      reminder: {
        reminder_kind: "time_to_leave",
        route_status: "ready",
        route_duration_seconds: 1500,
        arrival_buffer_minutes: 15,
      },
    });
    const listed = await api.listReminders({
      sourceType: "calendar_event",
      sourceItemId: "demo-event-review",
    });
    expect(listed.reminders).toHaveLength(1);
    expect(await api.deleteReminder(listed.reminders[0]!.id)).toEqual({ success: true });
    expect((await api.listReminders({
      sourceType: "calendar_event",
      sourceItemId: "demo-event-review",
    })).reminders).toEqual([]);
    expect(networkAttempted).toBe(false);
  });
});
