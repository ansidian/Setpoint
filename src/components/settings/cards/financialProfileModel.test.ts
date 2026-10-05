import { describe, expect, it } from "vitest";
import type { ActualMetadataResponse } from "../../../../shared/types/bills";
import type { FinancialConnection } from "../../../../shared/types/financial-connections";
import { availableProfileSchedules, profileTargetProblem } from "./financialProfileModel";

const metadata = (completed: boolean): ActualMetadataResponse => ({
  accounts: [
    { id: "checking", name: "Checking", closed: false },
    { id: "card", name: "Card", closed: false },
  ] as ActualMetadataResponse["accounts"],
  schedules: [
    { id: "pinned", name: "Card payment", type: "transfer", completed },
    { id: "old", name: "Old card payment", type: "transfer", completed: true },
  ] as ActualMetadataResponse["schedules"],
});

const provider = (scheduleId?: string) => ({
  id: "card-provider", name: "Card", budgetId: "budget", enabled: true, providerId: "sofi",
  senderAddresses: ["alerts@example.com"],
  target: { kind: "card_payment", fromAccountId: "checking", toAccountId: "card", ...(scheduleId ? { scheduleId } : {}) },
}) as FinancialConnection;

describe("card payment schedule pins", () => {
  it("keeps a pinned one-off payment schedule valid after Actual completes it", () => {
    expect(profileTargetProblem(provider("pinned"), metadata(true))).toBe("");
    expect(profileTargetProblem(provider("pinned"), metadata(false))).toBe("");
  });

  it("still reports a pinned schedule that no longer exists", () => {
    expect(profileTargetProblem(provider("deleted"), metadata(false))).not.toBe("");
  });

  it("offers only the pinned completed schedule, not every completed transfer", () => {
    expect(availableProfileSchedules("card_payment", metadata(true), "pinned")).toEqual([
      { id: "pinned", name: "Card payment (completed, reused next cycle)" },
    ]);
    expect(availableProfileSchedules("card_payment", metadata(true))).toEqual([]);
    expect(availableProfileSchedules("utility", metadata(true), "pinned")).toEqual([]);
  });
});
