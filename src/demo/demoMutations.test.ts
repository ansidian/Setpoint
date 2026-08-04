import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveSnapshotView, SnapshotItem } from "../../shared/types/snapshots";

let networkAttempted = false;

async function importDemoApi(now = "2026-05-12T15:30:00.000Z") {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "1");
  networkAttempted = false;
  vi.stubGlobal("fetch", () => { networkAttempted = true; throw new Error("Demo mode reached fetch"); });
  return import("../api");
}

function snapshotRows(snapshot: ActiveSnapshotView): SnapshotItem[] {
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
    expect(snapshotRows(await api.getActiveSnapshot()).find((row) => row.uid === "demo-email-budget")?.read).toBe(true);

    await api.markEmailAsUnread("demo-email-budget");
    expect(snapshotRows(await api.getActiveSnapshot()).find((row) => row.uid === "demo-email-budget")?.read).toBe(false);

    await api.trashEmail("demo-email-newsletter");
    expect(snapshotRows(await api.getActiveSnapshot()).some((row) => row.uid === "demo-email-newsletter")).toBe(false);

    await api.completeTask("demo-task-link");
    expect((await api.getCurrentDashboard()).deadlines.upcoming.find((task) => task.id === "demo-task-link")?.status).toBe("complete");

    const createdDeadline = await api.createDeadline({ title: "Demo launch checklist", dueDate: "2026-05-16" });
    await api.updateDeadline(createdDeadline.id, { title: "Demo launch checklist updated" });
    expect((await api.getCurrentDashboard()).deadlines.upcoming.find((task) => task.id === createdDeadline.id)?.title).toBe("Demo launch checklist updated");
    await api.completeDeadlineOccurrence(createdDeadline.id, "2026-05-16");
    expect((await api.getCurrentDashboard()).deadlines.upcoming.find((task) => task.id === createdDeadline.id)?.status).toBe("complete");

    const electricBill = (await api.getCalendarBillsRange("2026-05-01", "2026-05-31"))
      .schedules.find((bill) => bill.scheduleId === "demo-electric");
    if (!electricBill) throw new Error("Demo Electric bill is missing from the requested range");
    await api.markBillPaid(electricBill.id);
    expect((await api.getCalendarBillsRange("2026-05-01", "2026-05-31")).schedules.find((bill) => bill.scheduleId === "demo-electric")?.paid).toBe(true);

    expect(networkAttempted).toBe(false);
  });

  it("keeps bulk read state and demo task references available across reads", async () => {
    const api = await importDemoApi();

    await api.markAllEmailsAsRead(["demo-email-budget", "demo-email-prod-alert"]);
    const rows = snapshotRows((await api.getCurrentDashboard()).activeSnapshot);
    expect(rows.find((row) => row.uid === "demo-email-budget")?.read).toBe(true);
    expect(rows.find((row) => row.uid === "demo-email-prod-alert")?.read).toBe(true);

    await expect(api.getTodoistProjects()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.any(String), name: "Inbox", isInbox: true }),
    ]));
    await expect(api.getTodoistLabels()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
    ]));
    await expect(api.dismissTombstone("demo-task-link")).resolves.toEqual({ ok: true });
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
    expect(networkAttempted).toBe(false);
  });

  it("supports simple one-off calendar edits and rejects provider-like actions explicitly", async () => {
    const api = await importDemoApi();

    const created = await api.createCalendarEvent({
      title: "Demo follow-up",
      startDateTime: "2026-05-12T20:00:00.000Z",
      endDateTime: "2026-05-12T20:30:00.000Z",
      calendarId: "demo-work",
    });
    expect((await api.getCalendarSearch({ scope: "events", q: "follow-up" })).results[0]).toMatchObject({
      itemId: created.event.id,
      title: "Demo follow-up",
    });

    await api.updateCalendarEvent(created.event.id, { title: "Demo follow-up edited" });
    expect((await api.getCalendarSearch({ scope: "events", q: "edited" })).results[0]?.itemId).toBe(created.event.id);

    await api.deleteCalendarEvent(created.event.id, {});
    expect((await api.getCalendarSearch({ scope: "events", q: "edited" })).results).toEqual([]);

    await expect(api.getGmailAuthUrl()).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.testActualBudget(null)).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.saveActualBudgetConnection({ serverURL: "https://actual.example", syncId: "demo" })).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.removeActualBudgetConnection()).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.saveTodoistPersonalToken("demo-token")).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.disconnectTodoistConnection()).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.testDiscordReminderWebhook()).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });

    // P3-18: location autocomplete no longer surfaces DEMO_API_UNHANDLED; it
    // returns an inert empty-places shape so typing in the field stays quiet.
    expect(await api.getCalendarPlaceSuggestions("coffee")).toEqual({ places: [] });
  });

  it("preserves a non-Work demo calendar's identity when editing (P2-8)", async () => {
    const api = await importDemoApi();
    const created = await api.createCalendarEvent({
      title: "Personal dentist",
      startDateTime: "2026-05-12T20:00:00.000Z",
      endDateTime: "2026-05-12T20:30:00.000Z",
      calendarId: "demo-personal",
    });
    expect(created.event).toMatchObject({
      calendarId: "demo-personal",
      calendarName: "Demo Personal",
      color: "#cba6f7",
      sourceColor: "#cba6f7",
    });

    // Editing must NOT flip a Personal/Career event to Demo Work blue.
    const edited = await api.updateCalendarEvent(created.event.id, { title: "Personal dentist moved" });
    expect(edited.event).toMatchObject({
      calendarId: "demo-personal",
      calendarName: "Demo Personal",
      color: "#cba6f7",
      title: "Personal dentist moved",
    });
  });

  it("snoozes and restores an email in memory without throwing (P2-9)", async () => {
    const api = await importDemoApi();
    expect(snapshotRows(await api.getActiveSnapshot()).some((row) => row.uid === "demo-email-budget")).toBe(true);

    // Snooze removes the row from the active snapshot (no DEMO_API_UNHANDLED throw).
    await api.snoozeEmail("demo-email-budget", new Date("2026-05-12T18:00:00.000Z").getTime());
    expect(snapshotRows(await api.getActiveSnapshot()).some((row) => row.uid === "demo-email-budget")).toBe(false);

    // Undo (unsnooze) restores it to its lane, so the undo toast is truthful.
    await api.unsnoozeEmail("demo-email-budget");
    expect(snapshotRows(await api.getActiveSnapshot()).some((row) => row.uid === "demo-email-budget")).toBe(true);

    expect(networkAttempted).toBe(false);
  });
});
