import { afterEach, describe, expect, it, vi } from "vitest";

// Regression guard for the paste-then-instant-submit edge: a recurring-with-time
// title gets its time-of-day ONLY from chrono-node, which is lazily imported. A
// cold synchronous parse (the first parse on a one-shot paste + Enter) runs before
// chrono lands and silently drops the time. parseTokensWithChrono awaits the load
// first, so the re-parse keeps the time — with no React state involved, so it can't
// flake the way the reverted chronoReadyTick mirror did under workspace-switch load.
//
// Each test imports fresh modules so the chrono singleton starts COLD (do not warm
// it in a beforeAll here — that would mask the bug this file exists to catch).
async function freshParsing() {
  vi.resetModules();
  const parsing = await import("./parsing");
  const chrono = await import("../../calendar/events/parseCalendarTitle.js");
  return { parsing, chrono };
}

describe("parseTokensWithChrono (recurring-with-time paste edge)", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("recovers the recurring time-of-day that a cold synchronous parse drops", async () => {
    const { parsing, chrono } = await freshParsing();
    expect(chrono.isChronoReady()).toBe(false);

    // Document the bug: cold, the time-of-day is silently dropped.
    const cold = parsing.parseTokens("Pay rent every month at 3pm", [], []);
    expect(cold.recurringDueString).toBe("every month");

    // The fix: awaiting chrono before parsing keeps the time.
    const warmed = await parsing.parseTokensWithChrono("Pay rent every month at 3pm", [], []);
    expect(warmed.recurringDueString).toBe("every month at 3pm");
    expect(warmed.recurrenceDraft).toMatchObject({ frequency: "monthly", startTime: "15:00" });
  });

  it("stays correct on the already-warm path (idempotent re-parse)", async () => {
    const { parsing, chrono } = await freshParsing();
    await chrono.ensureChrono();
    expect(chrono.isChronoReady()).toBe(true);

    const warmed = await parsing.parseTokensWithChrono("Pay rent every month at 3pm", [], []);
    expect(warmed.recurringDueString).toBe("every month at 3pm");
  });
});
