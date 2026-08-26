import { describe, expect, it } from "vitest";
import type { SnapshotRecord } from "../../../shared/types/snapshots";
import { formatSnapshotContext } from "./snapshotSummary";

function snapshot(overrides: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    id: 20,
    snapshot_item_id: 20,
    status: "frozen",
    start_at: "2026-08-25T07:00:00.000Z",
    end_at: "2026-08-26T07:00:00.000Z",
    timezone: "America/Los_Angeles",
    ...overrides,
  };
}

describe("formatSnapshotContext", () => {
  it("orients a full-day historical window without repeating midnight", () => {
    expect(formatSnapshotContext(snapshot(), new Date("2026-08-26T18:00:00.000Z")))
      .toBe("Yesterday · Snapshot · 12:00 AM–midnight");
  });

  it("includes a scheduled boundary label and its time range", () => {
    expect(formatSnapshotContext(snapshot({
      schedule_label: "Morning",
      start_at: "2026-08-26T14:00:00.000Z",
      end_at: "2026-08-26T19:00:00.000Z",
    }), new Date("2026-08-26T18:00:00.000Z")))
      .toBe("Today · Morning · 7:00 AM–12:00 PM");
  });
});
