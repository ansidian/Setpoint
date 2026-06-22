import { describe, expect, it } from "vitest";
import { CURRENT_DATA_PROVIDERS } from "./current-providers/index.js";
import { planCurrentDataRefresh } from "./currentRefreshPlanModel.js";

describe("planCurrentDataRefresh", () => {
  const now = new Date("2026-06-21T00:00:00.000Z");

  it("force schedules every provider with reason 'force' and skips nothing", () => {
    const plan = planCurrentDataRefresh({}, { mode: "force", now, force: true });
    expect(plan.skipped).toEqual([]);
    expect(plan.scheduled.map((e) => e.key).sort()).toEqual(
      CURRENT_DATA_PROVIDERS.map((p) => p.key).sort(),
    );
    expect(plan.scheduled.every((e) => e.reason === "force")).toBe(true);
  });

  it("skips a not-timed-out refreshing row as 'already_refreshing'", () => {
    const rows = Object.fromEntries(
      CURRENT_DATA_PROVIDERS.map((p) => [
        p.key,
        { status: "refreshing", refresh_started_at: now.toISOString() },
      ]),
    );
    const plan = planCurrentDataRefresh(rows, { mode: "passive", now });
    expect(plan.scheduled).toEqual([]);
    expect(plan.skipped.every((e) => e.reason === "already_refreshing")).toBe(true);
    expect(plan.skipped).toHaveLength(CURRENT_DATA_PROVIDERS.length);
  });
});
