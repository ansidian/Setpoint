import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { laComponents } from "../../inbox/helpers";
import { ensureChrono } from "../../calendar/events/parseCalendarTitle";
import { parseTokens } from "./parsing";

// Pacific (DASHBOARD_TZ) Y-M-D string for an epoch, computed independently of the
// parser so the boundary assertions hold regardless of the host process TZ.
function pacificYmd(epochMs) {
  const la = laComponents(epochMs);
  return `${la.year}-${String(la.month + 1).padStart(2, "0")}-${String(la.day).padStart(2, "0")}`;
}

describe("Todoist task parsing", () => {
  // parseCalendarTitle lazily imports chrono-node now; warm it once (with real
  // timers, before the per-test fake-timer setup) so the synchronous parse paths
  // produce the natural-language time/date results the assertions expect.
  beforeAll(async () => {
    await ensureChrono();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects recurring NLP after Todoist tokens are stripped", () => {
    const projects = [{ id: "project-home", name: "Home", color: "#cba6da" }];
    const labels = [{ id: "label-chores", name: "chores", color: "#a6e3a1" }];

    const parsed = parseTokens("Water plants every weekday at 9am #Home @chores !2", projects, labels);

    expect(parsed.stripped).toBe("Water plants");
    expect(parsed.priority).toBe(2);
    expect(parsed.project).toMatchObject({ id: "project-home" });
    expect(parsed.labels).toEqual([expect.objectContaining({ id: "label-chores" })]);
    expect(parsed.recurringDueString).toBe("every weekday at 9am");
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "weekly",
      interval: 1,
      weekdays: ["MO", "TU", "WE", "TH", "FR"],
      startTime: "09:00",
    });
    expect(parsed.recurrenceSummary).toBe("Every Mon, Tue, Wed, Thu, Fri at 9 AM");
  });

  it("supports monthly and interval recurrence phrases", () => {
    const monthly = parseTokens("Pay rent every month", [], []);
    expect(monthly).toMatchObject({
      stripped: "Pay rent",
      recurringDueString: "every month",
      recurrenceDraft: expect.objectContaining({ frequency: "monthly", interval: 1 }),
    });
    expect(monthly.recurrenceSummary).not.toContain("9 AM");

    expect(parseTokens("Review every 2 weeks at 3pm", [], [])).toMatchObject({
      stripped: "Review",
      recurringDueString: "every 2 weeks at 3pm",
      recurrenceDraft: expect.objectContaining({ frequency: "weekly", interval: 2 }),
    });

    expect(parseTokens("Check backup every Monday", [], [])).toMatchObject({
      stripped: "Check backup",
      recurringDueString: "every mon",
      recurrenceDraft: expect.objectContaining({ frequency: "weekly", weekdays: ["MO"] }),
    });

    expect(parseTokens("Check backup every tue thu fri", [], [])).toMatchObject({
      stripped: "Check backup",
      recurringDueString: "every tue, thu, fri",
      recurrenceDraft: expect.objectContaining({ frequency: "weekly", weekdays: ["TU", "TH", "FR"] }),
    });
  });

  it("consumes at before a bare time", () => {
    const parsed = parseTokens("Submit assignment at 5pm", [], []);

    expect(parsed.stripped).toBe("Submit assignment");
    expect(parsed.datePhrase).toBe("at 5pm");
    expect(parsed.dateFormatted).toContain("5 PM");
  });

  it("keeps a seeded calendar date when parsing a bare time", () => {
    const parsed = parseTokens("Submit assignment at 5pm", [], [], {
      seededDueDate: "2026-04-23",
    });

    expect(parsed.stripped).toBe("Submit assignment");
    expect(parsed.datePhrase).toBe("at 5pm");
    expect(parsed.dateDueString).toBe("2026-04-23 at 5 PM");
    expect(parsed.duePreview).toMatchObject({
      dueDate: "2026-04-23",
      dueTime: "5 PM",
      dueTime24: "17:00",
    });
  });

  describe("Pacific-anchored relative dates", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("resolves 'today' to the Pacific day across the UTC midnight boundary (P3-31)", () => {
      // 2026-06-14T05:30Z is June 14 in UTC but June 13 22:30 in Pacific (PDT, UTC-7).
      // The due date must follow Pacific (DASHBOARD_TZ), not the browser/UTC day.
      const boundary = new Date("2026-06-14T05:30:00.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(boundary);

      const expectedPacific = pacificYmd(boundary.getTime());
      expect(expectedPacific).toBe("2026-06-13"); // sanity: Pacific is the prior day here

      const parsed = parseTokens("File report today", [], []);

      expect(parsed.duePreview.dueDate).toBe(expectedPacific);
      expect(parsed.dateFormatted).toContain("Today");
      expect(parsed.dateFormatted).toContain("Jun 13");
    });

    it("clamps 'in 1 month' from Jan 31 to the last day of February, not Mar 3 (P3-32)", () => {
      // Anchor "today" to Jan 31 in Pacific. 2026 is not a leap year, so the result
      // must be Feb 28 (standard add-months semantics), never overflow to March.
      const jan31 = new Date("2026-01-31T18:00:00.000Z"); // Jan 31 10:00 PST
      vi.useFakeTimers();
      vi.setSystemTime(jan31);
      expect(pacificYmd(jan31.getTime())).toBe("2026-01-31"); // sanity

      const parsed = parseTokens("Renew domain in 1 month", [], []);

      expect(parsed.duePreview.dueDate).toBe("2026-02-28");
      expect(parsed.dateFormatted).toContain("Feb 28");
    });

    it("clamps 'in 1 month' to Feb 29 in a leap year (P3-32)", () => {
      const jan31 = new Date("2024-01-31T18:00:00.000Z"); // 2024 is a leap year
      vi.useFakeTimers();
      vi.setSystemTime(jan31);
      expect(pacificYmd(jan31.getTime())).toBe("2024-01-31"); // sanity

      const parsed = parseTokens("Renew domain in 1 month", [], []);

      expect(parsed.duePreview.dueDate).toBe("2024-02-29");
    });
  });
});
