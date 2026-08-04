import { describe, expect, it } from "vitest";
import { logTiming } from "./timing.ts";

describe("timing logs", () => {
  it("uses console-compatible log functions", () => {
    const messages: string[] = [];
    const logger = (message: string) => { messages.push(message); };

    logTiming({ event: "boot", phase: "listen", ms: 1.6 }, logger);

    expect(messages).toEqual(['[EA Timing] {"event":"boot","phase":"listen","ms":2}']);
  });
});
