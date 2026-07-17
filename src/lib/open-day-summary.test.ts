import { describe, expect, it } from "vitest";
import { deriveOpenDaySummary } from "./open-day-summary";

const NOW = new Date("2026-04-19T16:00:00.000Z").getTime();

describe("deriveOpenDaySummary", () => {
  it("returns a light hint when nothing is pressing", () => {
    const result = deriveOpenDaySummary({ now: NOW });
    expect(result.tone).toBe("light");
    expect(result.primary).toBeNull();
    expect(result.hint).toMatch(/Calendar is open/i);
  });

  it("surfaces an overdue deadline as the highest-urgency primary item", () => {
    const result = deriveOpenDaySummary({
      now: NOW,
      deadlines: [
        { id: "d1", title: "Submit report", due_date: "2026-04-19", due_time: "8:00 AM", status: "open", class_name: "Ops" },
      ],
    });
    expect(result.tone).toBe("pressure");
    expect(result.primary!.kind).toBe("deadline");
    expect(result.primary!.urgency).toBe("high");
    expect(result.primary!.contextLabel).toBe("Overdue");
    expect(result.primary!.timingLabel).toBeNull();
    expect(result.primary!.title).toBe("Submit report");
  });

  it("uses overview-free copy for a soon deadline", () => {
    const result = deriveOpenDaySummary({
      now: NOW,
      deadlines: [
        { id: "d1", title: "Finalize deck", due_date: "2026-04-20", status: "open", class_name: "Ops" },
      ],
    });
    expect(result.primary!.contextLabel).toBe("Next deadline");
    expect(result.primary!.timingLabel).toBe("Due tomorrow");
    expect(result.primary!.label).toBe("Due tomorrow");
  });

  it("ranks deadlines above same-urgency bills and lists bills as a secondary", () => {
    const result = deriveOpenDaySummary({
      now: NOW,
      deadlines: [
        { id: "d1", title: "Pay tuition", due_date: "2026-04-21", status: "open" },
      ],
      bills: [
        { id: "b1", name: "Internet", amount: 80, next_date: "2026-04-22", paid: false },
      ],
    });
    expect(result.primary!.kind).toBe("deadline");
    expect(result.secondaries.map((item) => item.kind)).toContain("bill");
  });

  it("does not include paid bills, completed deadlines, or non-actionable emails", () => {
    const result = deriveOpenDaySummary({
      now: NOW,
      deadlines: [
        { id: "d1", title: "Done task", due_date: "2026-04-19", status: "complete" },
      ],
      bills: [
        { id: "b1", name: "Settled", amount: 10, next_date: "2026-04-19", paid: true },
      ],
      emails: {
        accounts: [
          { important: [{ id: "e1", subject: "FYI", triage: "fyi" }] },
        ],
      },
    });
    expect(result.tone).toBe("light");
  });

  it("counts actionable emails across accounts as a low-urgency item", () => {
    const result = deriveOpenDaySummary({
      now: NOW,
      emails: {
        accounts: [
          { important: [
            { id: "e1", triage: "actionable" },
            { id: "e2", triage: "actionable" },
            { id: "e3", triage: "fyi" },
          ] },
          { important: [{ id: "e4", triage: "actionable" }] },
        ],
      },
    });
    expect(result.tone).toBe("pressure");
    expect(result.primary!.kind).toBe("email");
    expect(result.primary!.contextLabel).toBe("Inbox");
    expect(result.primary!.timingLabel).toBe("3 actionable");
    expect(result.primary!.label).toBe("3 actionable");
  });
});
