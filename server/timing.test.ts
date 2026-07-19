import { describe, expect, it, vi } from "vitest";
import { logTiming } from "./timing.ts";

describe("timing logs", () => {
  it("uses console-compatible log functions", () => {
    const logger = vi.fn();

    logTiming({ event: "boot", phase: "listen", ms: 1.6 }, logger);

    expect(logger).toHaveBeenCalledWith('[EA Timing] {"event":"boot","phase":"listen","ms":2}');
  });
});
