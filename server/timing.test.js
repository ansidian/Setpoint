import { describe, expect, it, vi } from "vitest";
import { formatTimingLog, logTiming } from "./timing.js";

describe("timing logs", () => {
  it("formats stable single-line timing logs without undefined fields", () => {
    expect(formatTimingLog({
      event: "request",
      route: "/api/dashboard/current",
      ms: 12.44,
      status: 200,
      error: undefined,
    })).toBe('[EA Timing] {"event":"request","route":"/api/dashboard/current","ms":12,"status":200}');
  });

  it("uses console-compatible log functions", () => {
    const logger = vi.fn();

    logTiming({ event: "boot", phase: "listen", ms: 1.6 }, logger);

    expect(logger).toHaveBeenCalledWith('[EA Timing] {"event":"boot","phase":"listen","ms":2}');
  });
});
