import { describe, expect, it, vi } from "vitest";
import { resolveBillPaySeed } from "./bill-pay-service.ts";

describe("resolveBillPaySeed Actual reconciliation", () => {
  it("returns the canonical Actual status alongside the resolved bill seed", async () => {
    const dbClient = {
      execute: vi.fn().mockResolvedValue({ rows: [{ bill_pay_mappings_json: null }] }),
    };
    const metadataReader = vi.fn().mockResolvedValue({
      schedules: [{
        id: "schedule-acme",
        name: "Acme Utilities",
        next_date: "2026-08-12",
        completed: false,
        type: "bill",
        conditions: [
          { op: "is", field: "payee", value: "payee-acme" },
          { op: "is", field: "account", value: "checking" },
          { op: "is", field: "amount", value: -14231 },
        ],
      }],
      accounts: [{ id: "checking", name: "Checking" }],
      payeeMap: { "payee-acme": "Acme Utilities" },
      syncHealth: { state: "current", lastSuccessAt: "2026-07-16T16:00:00.000Z" },
    });
    const occurrenceReader = vi.fn().mockResolvedValue({
      schedules: [{
        scheduleId: "schedule-acme",
        name: "Acme Utilities",
        amount: 142.31,
        next_date: "2026-08-12",
        paid: false,
        type: "bill",
      }],
      syncHealth: { state: "current", lastSuccessAt: "2026-07-16T16:00:00.000Z" },
    });
    const transactionReader = vi.fn();

    const result = await resolveBillPaySeed("u1", {
      candidate: {
        type: "bill",
        payee: "Acme Utilities",
        payee_id: "payee-acme",
        account_id: "checking",
        amount: 142.31,
        due_date: "2026-08-12",
      },
      source: "triage",
      dbClient,
    }, {
      metadataReader,
      occurrenceReader,
      transactionReader,
      now: new Date("2026-07-16T18:00:00.000Z"),
    });

    expect(result.actualStatus).toMatchObject({
      status: "already_scheduled",
      evidence: { scheduleId: "schedule-acme" },
    });
    expect(occurrenceReader).toHaveBeenCalledWith(
      "u1",
      { start: "2026-08-12", end: "2026-08-12" },
      { dbClient },
    );
    expect(transactionReader).not.toHaveBeenCalled();
  });
});
