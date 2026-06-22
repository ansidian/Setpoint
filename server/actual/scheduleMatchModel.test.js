import { describe, it, expect } from "vitest";
import { findExistingSchedule, scheduleAmountMatches } from "./scheduleMatchModel.js";

const billSchedule = { id: "b", name: "Acme", conditions: [{ op: "is", field: "amount", value: -5000 }] };
const rangeBill = { id: "rb", name: "Acme", conditions: [{ op: "isbetween", field: "amount", value: { num1: -4000, num2: -6000 } }] };

describe("scheduleMatchModel cross-type guard (P3-76 drift fix)", () => {
  it("reuses same-sign scalar bill", () => expect(findExistingSchedule([billSchedule], null, null, -5000, "Acme")).toBe(billSchedule));
  it("rejects opposite-sign scalar", () => expect(findExistingSchedule([billSchedule], null, null, 5000, "Acme")).toBeNull());
  it("guards isbetween by range midpoint, not num1", () => {
    expect(findExistingSchedule([rangeBill], null, null, 5000, "Acme")).toBeNull();
    expect(findExistingSchedule([rangeBill], null, null, -5000, "Acme")).toBe(rangeBill);
  });
});

describe("scheduleAmountMatches isbetween band via shared bounds", () => {
  const c = { op: "isbetween", value: { num1: 6000, num2: 4000 } }; // out-of-order on purpose
  it("accepts inside the 0.7*lo..1.3*hi band", () => expect(scheduleAmountMatches(c, 5000)).toBe(true));
  it("rejects below the band", () => expect(scheduleAmountMatches(c, 2000)).toBe(false));
});
