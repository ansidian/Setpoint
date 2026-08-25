import { afterEach, describe, expect, it, vi } from "vitest";

async function importDemoApi(now = "2026-05-12T15:30:00.000Z") {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "1");
  return import("../api");
}

describe("demo mode read adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns stable rolling demo data for the core portfolio surfaces without fetch", async () => {
    let networkAttempted = false;
    vi.stubGlobal("fetch", () => { networkAttempted = true; throw new Error("Demo mode reached fetch"); });
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
    const importantSenders = await api.getImportantSenders();
    const models = await api.getModels();
    const billModels = await api.getBillExtractModels();

    expect(current.fetchedAt).toBe("2026-05-12T15:30:00.000Z");
    expect(current.weather).toMatchObject({
      temp: expect.any(Number),
      high: expect.any(Number),
      low: expect.any(Number),
      icon: expect.any(String),
      hourly: expect.arrayContaining([expect.objectContaining({ now: true })]),
      dailyForecast: expect.arrayContaining([expect.objectContaining({ dateKey: "2026-05-15" })]),
    });
    expect(current.deadlines.upcoming[0]?.due_date).toBe("2026-05-13");
    expect(current.activeSnapshot.lanes.needs_attention[0]).toMatchObject({
      uid: "demo-email-budget",
      subject: expect.stringContaining("Budget"),
    });
    expect(current.activeSnapshot.lanes.needs_attention.filter((email) => email.urgency === "high")).toHaveLength(3);
    expect(current.activeSnapshot.lanes.needs_attention.filter((email) => email.urgency === "normal")).toHaveLength(2);
    expect(current.deadlines.upcoming.find((task) => task.id === "demo-task-design-audit")?.due_date).toBe("2026-05-12");
    expect(snapshot).toEqual(current.activeSnapshot);
    expect("body" in emailBody ? emailBody.body : "").toContain("fictional demo");
    expect(calendarRange.events.some((event) => event.title === "Portfolio review prep")).toBe(true);
    expect(calendarSearch.results[0]).toMatchObject({
      type: "event",
      title: "Portfolio review prep",
      itemDate: "2026-05-12",
    });
    expect(deadlines.upcoming.some((task) => task.title === "Send portfolio demo link")).toBe(true);
    expect(bills.schedules.some((bill) => bill.payee === "Demo Electric")).toBe(true);
    expect(bills.schedules.find((bill) => bill.payee === "Everyday Card")?.next_date).toBe("2026-05-12");
    expect(bills.schedules.find((bill) => bill.payee === "Demo Electric")?.next_date).toBe("2026-05-13");
    expect(bills.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "income", payee: "Northstar Payroll" }),
      expect.objectContaining({ direction: "expense", payee: "Corner Market" }),
    ]));
    expect(bills.transactionsTruncated).toBe(false);
    expect("recentTransactions" in bills).toBe(false);
    expect(settings).toMatchObject({
      email_triage_mode: "auto",
      email_triage_classify_read_arrivals: false,
      demo: true,
    });
    const accountList = Array.isArray(accounts) ? accounts : accounts.accounts;
    expect(accountList).toHaveLength(2);
    expect(actual.accounts?.[0]).toMatchObject({ name: "Demo Checking" });
    expect(importantSenders).toEqual(expect.arrayContaining([
      { address: "morgan@northstar.example", name: "Morgan Lee", source: "auto" },
    ]));
    expect(importantSenders.length).toBeGreaterThanOrEqual(4);
    expect(models[0]).toMatchObject({
      provider: "demo",
      defaultModel: "demo-triage-model",
    });
    expect(billModels[0]).toMatchObject({
      provider: "demo",
      defaultModel: "demo-bill-extract-model",
    });
    expect(networkAttempted).toBe(false);
  });

  it("mutates the read-arrivals triage setting in memory", async () => {
    let networkAttempted = false;
    vi.stubGlobal("fetch", () => { networkAttempted = true; throw new Error("Demo mode reached fetch"); });
    const api = await importDemoApi();

    await api.updateSettings({ email_triage_classify_read_arrivals: true });

    expect(await api.getSettings()).toMatchObject({
      email_triage_classify_read_arrivals: true,
    });
    expect(networkAttempted).toBe(false);
  });

  it("keeps the portfolio demo populated like a busy SWE month", async () => {
    const api = await importDemoApi();

    const current = await api.getCurrentDashboard();
    const snapshot = await api.getActiveSnapshot();
    const calendarRange = await api.getCalendarRange("2026-05-01", "2026-05-31");
    const deadlines = await api.getCalendarDeadlinesRange("2026-05-01", "2026-05-31");
    const bills = await api.getCalendarBillsRange("2026-05-01", "2026-05-31");

    const rows = [
      ...(snapshot.carryover || []),
      ...Object.values(snapshot.lanes || {}).flat(),
    ];
    const calendarDays = new Set(calendarRange.events.map((event) => new Date(event.startMs).toLocaleDateString("en-CA")));
    const deadlineProjects = new Set(deadlines.upcoming.map((task) => task.class_name));

    expect(current.calendar.length).toBeGreaterThanOrEqual(20);
    expect(calendarRange.events.length).toBeGreaterThanOrEqual(30);
    expect(calendarDays.size).toBeGreaterThanOrEqual(18);
    expect(calendarRange.events.some((event) => event.title === "Backend platform standup")).toBe(true);
    expect(calendarRange.events.some((event) => event.title === "Incident review: webhook retries")).toBe(true);
    expect(deadlines.upcoming.length).toBeGreaterThanOrEqual(12);
    expect([...deadlineProjects]).toEqual(expect.arrayContaining(["Engineering", "Product", "Career"]));
    expect(bills.schedules.length).toBeGreaterThanOrEqual(6);
    expect(rows.length).toBeGreaterThanOrEqual(18);
    expect(snapshot.laneCounts).toMatchObject({
      queued: expect.any(Number),
      needs_attention: expect.any(Number),
      catch_up: expect.any(Number),
      fyi: expect.any(Number),
      noise: expect.any(Number),
      carryover: expect.any(Number),
    });
    expect(snapshot.laneCounts.needs_attention).toBeGreaterThanOrEqual(5);
    expect(snapshot.laneCounts.fyi).toBeGreaterThanOrEqual(4);
    expect(snapshot.laneCounts.noise).toBeGreaterThanOrEqual(3);
  });

  it("regenerates the seed from the viewer local date", async () => {
    const apiToday = await importDemoApi("2026-05-12T15:30:00.000Z");
    const today = await apiToday.getCurrentDashboard();

    const apiTomorrow = await importDemoApi("2026-05-13T15:30:00.000Z");
    const tomorrow = await apiTomorrow.getCurrentDashboard();

    expect(today.deadlines.upcoming.some((task) => task.due_date === "2026-05-12")).toBe(true);
    expect(tomorrow.deadlines.upcoming.some((task) => task.due_date === "2026-05-13")).toBe(true);
    expect(today.calendar[0]?.startMs).not.toBe(tomorrow.calendar[0]?.startMs);
  });

  it("isolates dashboard readers on unchanged reads", async () => {
    const api = await importDemoApi();

    const first = await api.getCurrentDashboard();
    const second = await api.getCurrentDashboard();

    expect(second).toEqual(first);

    first.activeSnapshot.lanes.needs_attention[0]!.subject = "Caller-only edit";
    expect((await api.getCurrentDashboard()).activeSnapshot.lanes.needs_attention[0]!.subject)
      .not.toBe("Caller-only edit");
  });

  it("returns dashboard data that consumers can clone", async () => {
    const api = await importDemoApi();
    const current = await api.getCurrentDashboard();

    expect(structuredClone(current)).toEqual(current);
  });

  it("keeps prior dashboard views stable when a later request mutates the seed", async () => {
    const api = await importDemoApi();
    const before = await api.getCurrentDashboard();

    await api.markEmailAsRead("demo-email-budget");
    const after = await api.getCurrentDashboard();

    expect(before.activeSnapshot.lanes.needs_attention[0]?.read).toBe(false);
    expect(after.activeSnapshot.lanes.needs_attention[0]?.read).toBe(true);
  });
});
