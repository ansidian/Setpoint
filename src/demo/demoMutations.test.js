import { afterEach, describe, expect, it, vi } from "vitest";

async function importDemoApi(now = "2026-05-12T15:30:00.000Z") {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "1");
  vi.stubGlobal("fetch", vi.fn());
  return import("../api.js");
}

function snapshotRows(snapshot) {
  return [
    ...(snapshot.carryover || []),
    ...Object.values(snapshot.lanes || {}).flat(),
  ];
}

describe("demo mode in-memory mutations", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("mutates email, task, and bill state in memory without fetch", async () => {
    const api = await importDemoApi();

    await api.markEmailAsRead("demo-email-budget");
    expect(snapshotRows(await api.getActiveSnapshot()).find((row) => row.uid === "demo-email-budget").read).toBe(true);

    await api.markEmailAsUnread("demo-email-budget");
    expect(snapshotRows(await api.getActiveSnapshot()).find((row) => row.uid === "demo-email-budget").read).toBe(false);

    await api.trashEmail("demo-email-newsletter");
    expect(snapshotRows(await api.getActiveSnapshot()).some((row) => row.uid === "demo-email-newsletter")).toBe(false);

    await api.completeTask("demo-task-link");
    expect((await api.getCurrentDashboard()).deadlines.upcoming.find((task) => task.id === "demo-task-link").status).toBe("complete");

    const createdDeadline = await api.createDeadline({ title: "Demo launch checklist", due_date: "2026-05-16" });
    await api.updateDeadline(createdDeadline.id, { title: "Demo launch checklist updated" });
    expect((await api.getCurrentDashboard()).deadlines.upcoming.find((task) => task.id === createdDeadline.id).title).toBe("Demo launch checklist updated");
    await api.completeDeadlineOccurrence(createdDeadline.id, "2026-05-16");
    expect((await api.getCurrentDashboard()).deadlines.upcoming.find((task) => task.id === createdDeadline.id).status).toBe("complete");

    await api.markBillPaid("demo-electric:2026-05-15");
    expect((await api.getCalendarBillsRange("2026-05-01", "2026-05-31")).schedules.find((bill) => bill.scheduleId === "demo-electric").paid).toBe(true);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("mutates notes and resets them when the app reloads", async () => {
    const api = await importDemoApi();

    const created = await api.createNote("Prep one clean demo path.");
    await api.updateNote(created.id, "Prep one clean demo path, then stop.");
    await api.reorderNotes([created.id, "demo-note-1", "demo-note-2"]);

    expect((await api.getNotes())[0]).toMatchObject({
      id: created.id,
      content: "Prep one clean demo path, then stop.",
    });

    await api.deleteNote(created.id);
    expect((await api.getNotes()).some((note) => note.id === created.id)).toBe(false);

    const reloadedApi = await importDemoApi();
    expect((await reloadedApi.getNotes()).map((note) => note.id)).toEqual([
      "demo-note-1",
      "demo-note-2",
      "demo-note-3",
      "demo-note-4",
    ]);
  });

  it("mutates important senders in memory without fetch", async () => {
    const api = await importDemoApi();

    await api.updateImportantSenders([
      { address: "morgan@northstar.example", name: "Morgan Lee", source: "auto" },
      { address: "avery@studio.example", name: "Avery Chen", source: "manual" },
    ]);

    expect(await api.getImportantSenders()).toEqual([
      { address: "morgan@northstar.example", name: "Morgan Lee", source: "auto" },
      { address: "avery@studio.example", name: "Avery Chen", source: "manual" },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports simple one-off calendar edits and rejects provider-like actions explicitly", async () => {
    const api = await importDemoApi();

    const created = await api.createCalendarEvent({
      title: "Demo follow-up",
      start: "2026-05-12T20:00:00.000Z",
      end: "2026-05-12T20:30:00.000Z",
      calendarId: "demo-work",
    });
    expect((await api.getCalendarSearch({ scope: "events", q: "follow-up" })).results[0]).toMatchObject({
      itemId: created.id,
      title: "Demo follow-up",
    });

    await api.updateCalendarEvent(created.id, { title: "Demo follow-up edited" });
    expect((await api.getCalendarSearch({ scope: "events", q: "edited" })).results[0].itemId).toBe(created.id);

    await api.deleteCalendarEvent(created.id);
    expect((await api.getCalendarSearch({ scope: "events", q: "edited" })).results).toEqual([]);

    await expect(api.getGmailAuthUrl()).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.getCalendarPlaceSuggestions("coffee")).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.testActualBudget()).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.testDiscordReminderWebhook()).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
  });
});
