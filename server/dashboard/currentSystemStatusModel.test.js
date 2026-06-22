import { describe, expect, it } from "vitest";
import { composeSystemStatus } from "./currentSystemStatusModel.js";

describe("composeSystemStatus", () => {
  it("rolls a stale todoist mirror into needs_sync", () => {
    const out = composeSystemStatus({
      currentData: { state: "current", lastSuccessAt: null },
      todoist: { state: "stale", severity: "warning" },
      bills: { state: "current" },
    }, { generatedAt: "2026-06-21T00:00:00.000Z" });
    const todoist = out.sources.find((s) => s.key === "todoist");
    expect(todoist.state).toBe("needs_sync");
    expect(out.generatedAt).toBe("2026-06-21T00:00:00.000Z");
  });

  it("derives a bills warning severity for needs_sync/degraded/stale", () => {
    const out = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "current" },
      bills: { state: "needs_sync" },
    });
    const bills = out.sources.find((s) => s.key === "bills");
    expect(bills.severity).toBe("warning");
  });

  it("summarizes unavailable when any source is in error, needs_sync when a warning source needs sync", () => {
    const errorOut = composeSystemStatus({
      currentData: { state: "unavailable" },
      todoist: { state: "current" },
      bills: { state: "current" },
    });
    expect(errorOut.state).toBe("unavailable");

    const needsSyncOut = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "needs_sync", severity: "warning" },
      bills: { state: "current" },
    });
    expect(needsSyncOut.state).toBe("needs_sync");
  });
});
