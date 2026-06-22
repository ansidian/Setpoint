import { describe, expect, it } from "vitest";
import {
  actualSessionKey,
  addDaysYmd,
  buildDateCondition,
  classifySchedules,
  findScheduleByName,
  findScheduleByPayee,
  mapRecentTransactions,
  mapUpcomingBills,
  projectSdkMetadata,
  transactionSearchStart,
} from "./actualCoreModel.js";

describe("actualSessionKey", () => {
  it("is stable across equal configs and varies on identity fields", () => {
    const a = actualSessionKey({ serverURL: "u", password: "p", syncId: "s", dataDir: "d", localBudgetId: "b" });
    const b = actualSessionKey({ serverURL: "u", password: "p", syncId: "s", dataDir: "d", localBudgetId: "b" });
    expect(a).toBe(b);
    expect(actualSessionKey({ serverURL: "u", syncId: "s" })).not.toBe(a);
  });

  it("treats missing optional fields as empty strings", () => {
    expect(actualSessionKey({ serverURL: "u", syncId: "s" }))
      .toBe(JSON.stringify({ serverURL: "u", password: "", syncId: "s", dataDir: "", localBudgetId: "" }));
  });
});

describe("classifySchedules", () => {
  const rawPayees = [
    { id: "payee-1", transfer_acct: null },
    { id: "transfer-payee", transfer_acct: "acct-1" },
  ];

  it("classifies income (positive), bill (negative), and transfer (transfer payee)", () => {
    const [income, bill, transfer] = classifySchedules([
      { conditions: [{ field: "payee", value: "payee-1" }, { field: "amount", op: "is", value: 250000 }] },
      { conditions: [{ field: "payee", value: "payee-1" }, { field: "amount", op: "is", value: -12234 }] },
      { conditions: [{ field: "payee", value: "transfer-payee" }, { field: "amount", op: "is", value: 5000 }] },
    ], rawPayees);
    expect(income.type).toBe("income");
    expect(bill.type).toBe("bill");
    expect(transfer.type).toBe("transfer");
  });
});

describe("findScheduleByPayee", () => {
  it("returns null when no payee matches", () => {
    expect(findScheduleByPayee([{ conditions: [{ field: "payee", value: "other" }] }], "p1", null, null)).toBeNull();
  });

  it("requires account to dominate even with a single payee match", () => {
    const schedules = [{ id: "s1", conditions: [{ field: "payee", value: "p1" }, { field: "account", value: "acctA" }] }];
    expect(findScheduleByPayee(schedules, "p1", "acctB", null)).toBeNull();
    expect(findScheduleByPayee(schedules, "p1", "acctA", null)?.id).toBe("s1");
  });

  it("disambiguates multiple account matches by the amount condition op", () => {
    const schedules = [
      { id: "is", conditions: [{ field: "payee", value: "p1" }, { field: "account", value: "a" }, { field: "amount", op: "is", value: -10000 }] },
      { id: "between", conditions: [{ field: "payee", value: "p1" }, { field: "account", value: "a" }, { field: "amount", op: "isbetween", value: { num1: -9000, num2: -11000 } }] },
    ];
    expect(findScheduleByPayee(schedules, "p1", "a", 10000)?.id).toBe("is");
    expect(findScheduleByPayee(schedules, "p1", "a", 9500)?.id).toBe("between");
  });
});

describe("findScheduleByName cross-type guard (P3-76 SDK-path drift fix)", () => {
  const billSchedule = { id: "b", name: "Acme", conditions: [{ op: "is", field: "amount", value: -5000 }] };
  const rangeBill = { id: "rb", name: "Acme", conditions: [{ op: "isbetween", field: "amount", value: { num1: -4000, num2: -6000 } }] };

  it("returns null when no schedule has the name", () => {
    expect(findScheduleByName([billSchedule], "Other", -5000)).toBeNull();
  });

  it("reuses a same-sign scalar bill", () => {
    expect(findScheduleByName([billSchedule], "Acme", -5000)).toBe(billSchedule);
  });

  it("rejects an opposite-sign scalar (transfer must not clobber a same-named bill)", () => {
    expect(findScheduleByName([billSchedule], "Acme", 5000)).toBeNull();
  });

  it("guards an isbetween range by its midpoint sign, not by skipping the object", () => {
    // The legacy `typeof value === "number"` gate skipped isbetween objects entirely,
    // so a positive transfer would clobber this negative range bill.
    expect(findScheduleByName([rangeBill], "Acme", 5000)).toBeNull();
    expect(findScheduleByName([rangeBill], "Acme", -5000)).toBe(rangeBill);
  });

  it("reuses a same-named schedule with no amount condition (guard is a no-op)", () => {
    const noAmount = { id: "na", name: "Acme", conditions: [{ op: "is", field: "payee", value: "p1" }] };
    expect(findScheduleByName([noAmount], "Acme", 5000)).toBe(noAmount);
  });
});

describe("buildDateCondition", () => {
  it("builds a plain 'is' date condition when there is no recurrence", () => {
    expect(buildDateCondition([], "2026-05-20")).toEqual({ op: "is", field: "date", value: "2026-05-20" });
  });

  it("rebases the start of a simple recurrence but keeps complex (interval>1) as-is", () => {
    const simple = [{ op: "repeat", field: "date", value: { frequency: "monthly", interval: 1, start: "2026-01-01" } }];
    expect(buildDateCondition(simple, "2026-05-20").value).toMatchObject({ frequency: "monthly", interval: 1, start: "2026-05-20" });
    const complex = [{ op: "repeat", field: "date", value: { frequency: "monthly", interval: 3, start: "2026-01-01" } }];
    expect(buildDateCondition(complex, "2026-05-20").value.start).toBe("2026-01-01");
  });
});

describe("addDaysYmd / transactionSearchStart", () => {
  it("addDaysYmd advances a ymd in UTC", () => {
    expect(addDaysYmd("2026-05-20", -14)).toBe("2026-05-06");
  });

  it("transactionSearchStart is 14 days before the earliest schedule date, or null when none", () => {
    expect(transactionSearchStart([{ next_date: "2026-05-20" }, { next_date: "2026-05-10" }])).toBe("2026-04-26");
    expect(transactionSearchStart([{ next_date: null }, {}])).toBeNull();
  });
});

describe("mapRecentTransactions", () => {
  it("maps payee/amount/date and drops rows missing payee or amount", () => {
    const payeeMap = { "payee-1": "Power Co" };
    expect(mapRecentTransactions([
      { payee: "payee-1", amount: -12234, date: "2026-05-11", schedule: "s1" },
      { payee: null, amount: -100, date: "2026-05-12" },
      { payee: "payee-1", amount: 0, date: "2026-05-13" },
    ], payeeMap)).toEqual([
      { payee: "Power Co", payeeId: "payee-1", amount: 122.34, date: "2026-05-11", scheduleId: "s1" },
    ]);
  });
});

describe("projectSdkMetadata", () => {
  it("projects accounts (open, sorted), payees, payeeMap, categories (no Internal), classified schedules, and recent txns", () => {
    const result = projectSdkMetadata({
      rawAccounts: [
        { id: "a2", name: "Savings", type: "savings", closed: false },
        { id: "a1", name: "Checking", type: "checking", closed: false },
        { id: "a3", name: "Closed", type: "credit", closed: true },
      ],
      rawPayees: [
        { id: "payee-1", name: "Power Co", transfer_acct: null },
        { id: "transfer-payee", name: "Transfer", transfer_acct: "a1" },
      ],
      groups: [
        { name: "Bills", categories: [{ id: "c1", name: "Utilities" }] },
        { name: "Internal", categories: [{ id: "ci", name: "Hidden" }] },
      ],
      schedules: [{ conditions: [{ field: "payee", value: "payee-1" }, { field: "amount", op: "is", value: -12234 }] }],
      recentTxns: [{ payee: "payee-1", amount: -12234, date: "2026-05-11", schedule: "s1" }],
    });

    expect(result.accounts).toEqual([
      { id: "a1", name: "Checking", type: "checking" },
      { id: "a2", name: "Savings", type: "savings" },
    ]);
    expect(result.payees).toEqual([{ id: "payee-1", name: "Power Co" }]);
    expect(result.payeeMap).toEqual({ "payee-1": "Power Co", "transfer-payee": "Transfer" });
    expect(result.categories).toEqual([{ group_name: "Bills", categories: [{ id: "c1", name: "Utilities" }] }]);
    expect(result.schedules[0].type).toBe("bill");
    expect(result.recentTransactions).toEqual([
      { payee: "Power Co", payeeId: "payee-1", amount: 122.34, date: "2026-05-11", scheduleId: "s1" },
    ]);
  });
});

describe("mapUpcomingBills", () => {
  const window = { today: "2026-05-20", weekFromNow: "2026-05-27" };
  const payeeMap = { "payee-1": "Power Co" };

  it("filters to non-income schedules within the week and derives amount/payee/paid/overdue flags", () => {
    const schedules = [
      { id: "bill", name: "Power", type: "bill", next_date: "2026-05-22", conditions: [{ field: "amount", op: "is", value: -12234 }, { field: "payee", value: "payee-1" }] },
      { id: "income", name: "Paycheck", type: "income", next_date: "2026-05-23", conditions: [{ field: "amount", op: "is", value: 250000 }] },
      { id: "far", name: "Later", type: "bill", next_date: "2026-06-15", conditions: [{ field: "amount", op: "is", value: -5000 }] },
      { id: "overdue", name: "Old", type: "bill", next_date: "2026-05-18", conditions: [{ field: "amount", op: "is", value: -3000 }] },
    ];
    const bills = mapUpcomingBills(schedules, payeeMap, [], window);
    expect(bills.map((b) => b.id)).toEqual(["overdue", "bill"]); // income + far excluded, sorted by date
    const bill = bills.find((b) => b.id === "bill");
    expect(bill).toMatchObject({ payee: "Power Co", amount: 122.34, isDueToday: false, isOverdue: false, paid: false, type: "bill" });
    expect(bills.find((b) => b.id === "overdue")).toMatchObject({ isOverdue: true });
  });
});
