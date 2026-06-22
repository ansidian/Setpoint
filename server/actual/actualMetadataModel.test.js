import { describe, expect, it } from "vitest";
import {
  actualDateInt,
  classifySchedules,
  normalizeRuleConditions,
  projectActualMetadata,
  ymdFromActualDate,
} from "./actualMetadataModel.js";

describe("ymdFromActualDate", () => {
  it("expands an 8-digit Actual integer date to ISO", () => {
    expect(ymdFromActualDate(20260510)).toBe("2026-05-10");
    expect(ymdFromActualDate("20260510")).toBe("2026-05-10");
  });

  it("passes an already-ISO date through unchanged", () => {
    expect(ymdFromActualDate("2026-05-10")).toBe("2026-05-10");
  });

  it("returns null for empty input and the raw string for unrecognized shapes", () => {
    expect(ymdFromActualDate("")).toBeNull();
    expect(ymdFromActualDate(null)).toBeNull();
    expect(ymdFromActualDate("garbage")).toBe("garbage");
  });
});

describe("actualDateInt", () => {
  it("strips dashes and coerces to a number", () => {
    expect(actualDateInt("2026-05-10")).toBe(20260510);
    expect(actualDateInt("")).toBe(0);
  });
});

describe("normalizeRuleConditions", () => {
  it("rewrites description->payee and acct->account field aliases", () => {
    const conditions = normalizeRuleConditions(JSON.stringify([
      { field: "description", value: "payee-1" },
      { field: "acct", value: "acct-1" },
      { field: "amount", value: -100 },
    ]));
    expect(conditions).toEqual([
      { field: "payee", value: "payee-1" },
      { field: "account", value: "acct-1" },
      { field: "amount", value: -100 },
    ]);
  });

  it("returns an empty array for invalid or empty JSON", () => {
    expect(normalizeRuleConditions("not json")).toEqual([]);
    expect(normalizeRuleConditions("")).toEqual([]);
    expect(normalizeRuleConditions(null)).toEqual([]);
  });
});

describe("classifySchedules", () => {
  const rawPayees = [
    { id: "payee-1", transfer_acct: null },
    { id: "transfer-payee", transfer_acct: "acct-1" },
  ];

  it("classifies a positive-amount schedule as income", () => {
    const [schedule] = classifySchedules([
      { id: "s1", conditions: [{ field: "payee", value: "payee-1" }, { field: "amount", value: 250000 }] },
    ], rawPayees);
    expect(schedule.type).toBe("income");
  });

  it("classifies a negative-amount schedule as a bill", () => {
    const [schedule] = classifySchedules([
      { id: "s2", conditions: [{ field: "payee", value: "payee-1" }, { field: "amount", value: -12234 }] },
    ], rawPayees);
    expect(schedule.type).toBe("bill");
  });

  it("classifies a transfer-payee schedule as transfer regardless of sign", () => {
    const [schedule] = classifySchedules([
      { id: "s3", conditions: [{ field: "payee", value: "transfer-payee" }, { field: "amount", value: 5000 }] },
    ], rawPayees);
    expect(schedule.type).toBe("transfer");
  });
});

describe("projectActualMetadata", () => {
  function rawResults() {
    return {
      rawAccounts: { rows: [{ id: "acct-1", name: "Checking", type: "checking" }] },
      rawPayees: {
        rows: [
          { id: "payee-1", name: "Power Co", transfer_acct: null },
          { id: "transfer-payee", name: "Transfer", transfer_acct: "acct-1" },
          { id: "nameless", name: "", transfer_acct: null },
        ],
      },
      rawGroups: {
        rows: [
          { id: "group-1", name: "Bills", sort_order: 1 },
          { id: "internal", name: "Internal", sort_order: 2 },
        ],
      },
      rawCategories: { rows: [{ id: "cat-1", name: "Utilities", cat_group: "group-1", sort_order: 1 }] },
      rawSchedules: {
        rows: [
          {
            id: "sched-1",
            name: "Power Bill",
            rule: "rule-1",
            next_date: 20260510,
            completed: 0,
            _conditions: '[{"field":"description","value":"payee-1"},{"field":"amount","value":-12234},{"field":"acct","value":"acct-1"}]',
          },
        ],
      },
      rawTransactions: {
        rows: [{ id: "txn-1", date: 20260511, amount: -12234, payee: "payee-1", schedule: "sched-1" }],
      },
    };
  }

  it("projects accounts, payees, categories, schedules, and recent transactions", () => {
    const result = projectActualMetadata(rawResults());

    expect(result.accounts).toEqual([{ id: "acct-1", name: "Checking", type: "checking" }]);
    // Transfer payees and nameless payees are excluded from the picker list.
    expect(result.payees).toEqual([{ id: "payee-1", name: "Power Co" }]);
    // payeeMap retains every payee id, including transfer/nameless, for lookups.
    expect(result.payeeMap).toEqual({ "payee-1": "Power Co", "transfer-payee": "Transfer", nameless: "" });
    // The Internal group is dropped from the user-facing category tree.
    expect(result.categories).toEqual([
      { group_name: "Bills", categories: [{ id: "cat-1", name: "Utilities" }] },
    ]);
    expect(result.schedules).toEqual([
      expect.objectContaining({
        id: "sched-1",
        next_date: "2026-05-10",
        type: "bill",
        conditions: [
          { field: "payee", value: "payee-1" },
          { field: "amount", value: -12234 },
          { field: "account", value: "acct-1" },
        ],
      }),
    ]);
    expect(result.recentTransactions).toEqual([
      { payee: "Power Co", payeeId: "payee-1", amount: 122.34, date: "2026-05-11", scheduleId: "sched-1" },
    ]);
  });

  it("converts transaction cents to absolute dollars and null schedule ids", () => {
    const raw = rawResults();
    raw.rawTransactions = { rows: [{ id: "txn-2", date: 20260512, amount: 9900, payee: "payee-1", schedule: null }] };
    const [txn] = projectActualMetadata(raw).recentTransactions;
    expect(txn.amount).toBe(99);
    expect(txn.scheduleId).toBeNull();
  });
});
