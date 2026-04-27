import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTokens } from "./parsing";

describe("Todoist task parsing", () => {
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
});
