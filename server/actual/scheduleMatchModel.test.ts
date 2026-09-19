import { describe, it, expect } from "vitest";
import { scheduleAmountMatches } from "./scheduleMatchModel.ts";

describe("scheduleAmountMatches isbetween band via shared bounds", () => {
  const c = { op: "isbetween", value: { num1: 6000, num2: 4000 } }; // out-of-order on purpose
  it("accepts inside the 0.7*lo..1.3*hi band", () => expect(scheduleAmountMatches(c, 5000)).toBe(true));
  it("rejects below the band", () => expect(scheduleAmountMatches(c, 2000)).toBe(false));
});
