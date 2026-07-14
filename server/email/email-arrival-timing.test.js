import { describe, expect, it } from "vitest";
import { projectEmailArrivalTiming } from "./email-arrival-timing.js";

describe("projectEmailArrivalTiming", () => {
  it("projects provider, queue, sync, and snapshot stages", () => {
    expect(projectEmailArrivalTiming({
      providerPublishedAt: "2026-07-14T12:00:00.000Z",
      historyQueuedAt: "2026-07-14 12:00:01",
      historyClaimedAt: "2026-07-14T12:00:01.250Z",
      snapshotQueuedAt: "2026-07-14T12:00:02.000Z",
      completedAt: "2026-07-14T12:00:02.500Z",
    })).toEqual({
      providerDeliveryMs: 1000,
      historyQueueWaitMs: 250,
      historySyncMs: 1250,
      providerToQueuedMs: 2000,
      snapshotAttachmentMs: 500,
      valid: true,
      clockSkewClamped: false,
      invalidFields: [],
    });
  });

  it("omits durations that depend on missing timestamps", () => {
    expect(projectEmailArrivalTiming({
      historyQueuedAt: "2026-07-14T12:00:01.000Z",
      historyClaimedAt: "2026-07-14T12:00:01.250Z",
      completedAt: "2026-07-14T12:00:02.500Z",
    })).toEqual({
      historyQueueWaitMs: 250,
      historySyncMs: 1250,
      valid: false,
      clockSkewClamped: false,
      invalidFields: [
        "providerPublishedAt:missing",
        "snapshotQueuedAt:missing",
      ],
    });
  });

  it("marks malformed timestamps without returning NaN", () => {
    const timing = projectEmailArrivalTiming({
      providerPublishedAt: "not-a-date",
      historyQueuedAt: "2026-07-14T12:00:01.000Z",
      historyClaimedAt: "2026-07-14T12:00:01.250Z",
      snapshotQueuedAt: "2026-07-14T12:00:02.000Z",
      completedAt: "2026-07-14T12:00:02.500Z",
    });

    expect(timing).not.toHaveProperty("providerDeliveryMs");
    expect(timing).not.toHaveProperty("providerToQueuedMs");
    expect(timing.invalidFields).toEqual(["providerPublishedAt:invalid"]);
    expect(JSON.stringify(timing)).not.toContain("NaN");
  });

  it("clamps clock-skewed stages to zero", () => {
    const timing = projectEmailArrivalTiming({
      providerPublishedAt: "2026-07-14T12:00:02.000Z",
      historyQueuedAt: "2026-07-14T12:00:01.000Z",
      historyClaimedAt: "2026-07-14T12:00:00.500Z",
      snapshotQueuedAt: "2026-07-14T12:00:01.500Z",
      completedAt: "2026-07-14T12:00:03.000Z",
    });

    expect(timing).toMatchObject({
      providerDeliveryMs: 0,
      historyQueueWaitMs: 0,
      providerToQueuedMs: 0,
      valid: false,
      clockSkewClamped: true,
    });
  });
});
