import { describe, expect, it } from "vitest";
import type { ActualScheduleCondition } from "../../shared/types/actual.ts";
import { reconcileActualTransferSchedule } from "./actualTransferSchedules.ts";

type RuleRow = {
  id: string;
  conditions: ActualScheduleCondition[];
  conditions_op: string;
  actions: Array<{ op: string; value: string }>;
  tombstone: boolean;
};

type ScheduleRow = {
  id: string;
  name: string;
  rule: string;
  next_date: string;
  completed: boolean;
  tombstone: boolean;
};

function transferSdkWithCompletedPriorPayment() {
  const rules: RuleRow[] = [{
    id: "rule-prior",
    conditions: [
      { field: "account", op: "is", value: "card" },
      { field: "payee", op: "is", value: "transfer-funding" },
      { field: "amount", op: "is", value: 10_000 },
      { field: "date", op: "is", value: "2026-08-28" },
    ],
    conditions_op: "and",
    actions: [{ op: "link-schedule", value: "schedule-prior" }],
    tombstone: false,
  }];
  const schedules: ScheduleRow[] = [{
    id: "schedule-prior",
    name: "Example Card Payment",
    rule: "rule-prior",
    next_date: "2026-08-28",
    completed: true,
    tombstone: false,
  }];

  const sdk = {
    sync: async () => undefined,
    getAccounts: async () => [
      { id: "funding", name: "Funding", type: "checking", closed: false },
      { id: "card", name: "Example Card", type: "credit", closed: false },
    ],
    getPayees: async () => [{ id: "transfer-funding", name: "Transfer: Funding", transfer_acct: "funding" }],
    getRules: async () => rules,
    q: (dataset: string) => {
      const query = {
        dataset,
        filter: () => query,
        select: () => query,
        withDead: () => query,
        withoutValidatedRefs: () => query,
      };
      return query;
    },
    runQuery: async (query: unknown) => ({
      data: (query as { dataset: string }).dataset === "rules" ? rules
        : (query as { dataset: string }).dataset === "schedules" ? schedules
          : [],
    }),
    internal: {
      send: async (_operation: string, rawPayload: unknown) => {
        const payload = rawPayload as {
        schedule: { id: string; name: string; completed: boolean; tombstone: boolean };
        conditions: ActualScheduleCondition[];
        };
        if (schedules.some((schedule) => !schedule.tombstone && schedule.name === payload.schedule.name)) {
          throw new Error("Cannot create schedules with the same name");
        }
        const ruleId = "rule-new";
        rules.push({
          id: ruleId,
          conditions: payload.conditions,
          conditions_op: "and",
          actions: [{ op: "link-schedule", value: payload.schedule.id }],
          tombstone: false,
        });
        schedules.push({
          ...payload.schedule,
          rule: ruleId,
          next_date: String(payload.conditions.find((condition) => condition.field === "date")?.value),
        });
      },
    },
  };

  return { sdk, schedules };
}

describe("reconcileActualTransferSchedule", () => {
  it("creates a later payment when a completed schedule already uses its base name", async () => {
    const { sdk, schedules } = transferSdkWithCompletedPriorPayment();

    const result = await reconcileActualTransferSchedule(sdk, "budget", {
      identityKey: "payment-september",
      fromAccountId: "funding",
      toAccountId: "card",
      date: "2026-09-28",
      amountCents: 21_266,
      name: "Example Card Payment",
      budgetId: "budget",
    }, "create_once", new Date("2026-09-04T12:00:00Z"));

    expect(result.outcome).toBe("created");
    expect(schedules).toHaveLength(2);
    expect(schedules[1]!.name).toBe("Example Card Payment (2026-09-28)");
  });
});
