import { afterEach, describe, expect, it, vi } from "vitest";

async function importDemoApi(now = "2026-05-12T15:30:00.000Z") {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "1");
  return import("../api.js");
}

describe("demo mode read adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns stable rolling demo data for the core portfolio surfaces without fetch", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const api = await importDemoApi();

    const current = await api.getCurrentDashboard();
    const snapshot = await api.getActiveSnapshot();
    const emailBody = await api.getEmailBody("demo-email-budget");
    const calendarRange = await api.getCalendarRange("2026-05-01", "2026-05-31");
    const calendarSearch = await api.getCalendarSearch({ scope: "events", q: "review" });
    const deadlines = await api.getCalendarDeadlinesRange("2026-05-01", "2026-05-31");
    const bills = await api.getCalendarBillsRange("2026-05-01", "2026-05-31");
    const settings = await api.getSettings();
    const accounts = await api.getAccounts();
    const actual = await api.getActualMetadata();
    const notes = await api.getNotes();
    const importantSenders = await api.getImportantSenders();
    const models = await api.getModels();
    const billModels = await api.getBillExtractModels();

    expect(current.fetchedAt).toBe("2026-05-12T15:30:00.000Z");
    expect(current.weather).toMatchObject({ temp: expect.any(Number), icon: expect.any(String) });
    expect(current.deadlines.upcoming[0].due_date).toBe("2026-05-13");
    expect(current.activeSnapshot.lanes.needs_attention[0]).toMatchObject({
      uid: "demo-email-budget",
      subject: expect.stringContaining("Budget"),
    });
    expect(snapshot).toEqual(current.activeSnapshot);
    expect(emailBody.body).toContain("fictional demo");
    expect(calendarRange.events.some((event) => event.title === "Portfolio review prep")).toBe(true);
    expect(calendarSearch.results[0]).toMatchObject({
      type: "event",
      title: "Portfolio review prep",
      itemDate: "2026-05-12",
    });
    expect(deadlines.upcoming.some((task) => task.title === "Send portfolio demo link")).toBe(true);
    expect(bills.schedules.some((bill) => bill.payee === "Demo Electric")).toBe(true);
    expect(settings).toMatchObject({ email_triage_mode: "auto", demo: true });
    expect(accounts.accounts).toHaveLength(2);
    expect(actual.accounts[0]).toMatchObject({ name: "Demo Checking" });
    expect(notes[0].content).toContain("Demo walkthrough");
    expect(importantSenders).toEqual([
      { address: "morgan@northstar.example", name: "Morgan Lee", source: "auto" },
    ]);
    expect(models[0]).toMatchObject({
      provider: "demo",
      defaultModel: "demo-triage-model",
    });
    expect(billModels[0]).toMatchObject({
      provider: "demo",
      defaultModel: "demo-bill-extract-model",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("regenerates the seed from the viewer local date", async () => {
    const apiToday = await importDemoApi("2026-05-12T15:30:00.000Z");
    const today = await apiToday.getCurrentDashboard();

    const apiTomorrow = await importDemoApi("2026-05-13T15:30:00.000Z");
    const tomorrow = await apiTomorrow.getCurrentDashboard();

    expect(today.deadlines.upcoming.some((task) => task.due_date === "2026-05-12")).toBe(true);
    expect(tomorrow.deadlines.upcoming.some((task) => task.due_date === "2026-05-13")).toBe(true);
    expect(today.calendar[0].startMs).not.toBe(tomorrow.calendar[0].startMs);
  });
});
