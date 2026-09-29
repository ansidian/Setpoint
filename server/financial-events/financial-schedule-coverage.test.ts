import { describe, expect, it } from "vitest";
import { describeScheduleCoverage, findScheduleCoverage } from "./financial-schedule-coverage.ts";
import type { ActualSchedule } from "../../shared/types/actual.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";

function schedule(id: string, name: string, payee: string, amount: number | { num1: number; num2: number }, next_date: string,
  { op = "is", type = "bill" as ActualSchedule["type"] } = {}): ActualSchedule {
  return { id, name, next_date, type, posts_transaction: true, completed: false, conditions: [
    { field: "amount", op, value: amount }, { field: "payee", op: "is", value: payee }, { field: "account", op: "is", value: "checking" },
  ] };
}

const metadata = {
  payees: [{ id: "apple", name: "Apple" }, { id: "streambox", name: "StreamBox" }, { id: "power", name: "Power Co" },
    { id: "employer", name: "Employer" }, { id: "card-payee", name: "Example Card (1234) Payment" }],
  schedules: [
    schedule("reader", "Reader App", "apple", -399, "2026-10-26"),
    schedule("family", "Family Cloud", "apple", -99, "2026-10-18"),
    schedule("stream", "StreamBox", "streambox", -1000, "2026-10-26", { op: "isapprox" }),
    schedule("card", "Example Card (1234) Payment", "card-payee", -20743, "2026-10-05", { type: "transfer" }),
    schedule("utility", "Power", "power", -24361, "2026-10-14", { op: "isapprox" }),
    schedule("paycheck", "Paycheck", "employer", 150000, "2026-10-01", { type: "income" }),
  ],
  recentTransactions: [{ id: "posted-reader", date: "2026-09-26", amount: 3.99, scheduleId: "reader" }],
};

const purchase = (fields: Partial<BillCandidate>): BillCandidate => ({ type: "expense", event_kind: "purchase", currency: "USD", ...fields });

describe("Actual schedule coverage", () => {
  it.each([
    ["an already-posted schedule transaction", purchase({ payee_hint: "Apple Services", amount: 3.99, due_date: "2026-09-26" }), null,
      { scheduleId: "reader", state: "posted", date: "2026-09-26" }],
    ["the email date when the receipt has none", purchase({ payee_hint: "Apple Services", amount: 3.99, due_date: null }), "2026-09-27",
      { scheduleId: "reader", state: "posted" }],
    ["an upcoming occurrence Actual has not posted yet", purchase({ payee_hint: "Apple Services", amount: 0.99, due_date: "2026-10-17" }), null,
      { scheduleId: "family", state: "pending_post", date: "2026-10-18" }],
    ["Actual's approximate amount tolerance", purchase({ payee: "StreamBox", amount: 10.5, due_date: "2026-10-26" }), null,
      { scheduleId: "stream", state: "pending_post" }],
    ["an exactly dated scheduled payment without an amount", { type: "transfer", event_kind: "payment_scheduled", payee: "Example",
      account_last4: "1234", amount: null, due_date: "2026-10-05" } as BillCandidate, null, { scheduleId: "card", state: "pending_post" }],
    ["a scheduled payment with the exact amount", { type: "transfer", event_kind: "payment_scheduled", payee: "Example",
      account_last4: "1234", amount: 207.43, due_date: "2026-10-04" } as BillCandidate, null, { scheduleId: "card" }],
    ["scheduled income", { type: "income", event_kind: "other", payee: "Employer", amount: 1500, due_date: "2026-10-01" } as BillCandidate, null,
      { scheduleId: "paycheck" }],
  ])("covers %s", (_name, candidate, fallbackDate, expected) => {
    expect(findScheduleCoverage(candidate, metadata, fallbackDate)).toMatchObject(expected);
  });

  it.each([
    ["the same payee with a different amount", purchase({ payee_hint: "Apple Services", amount: 4.99, due_date: "2026-09-26" })],
    ["the same amount from an unrelated payee", purchase({ payee_hint: "Other Shop", amount: 3.99, due_date: "2026-09-26" })],
    ["an occurrence outside the date window", purchase({ payee_hint: "Apple Services", amount: 0.99, due_date: "2026-10-25" })],
    ["the opposite direction", { type: "income", event_kind: "other", payee: "Apple", amount: 3.99, due_date: "2026-09-26" } as BillCandidate],
    ["a purchase whose payee shares a name with a card-payment transfer", purchase({ payee: "Example", amount: 207.43, due_date: "2026-10-05" })],
    ["only generic words in common", purchase({ payee: "Payment Services", amount: 3.99, due_date: "2026-09-26" })],
    ["a missing amount on an ordinary purchase", purchase({ payee: "Apple", amount: null, due_date: "2026-10-18" })],
    ["a utility bill that updates its schedule", { type: "bill", event_kind: "bill_issued", payee: "Power Co", amount: 250, due_date: "2026-10-14" } as BillCandidate],
    ["a card statement that updates its schedule", { type: "transfer", event_kind: "statement_issued", payee: "Example", account_last4: "1234",
      amount: 207.43, due_date: "2026-10-05" } as BillCandidate],
    ["a changed scheduled-payment amount that must update the schedule", { type: "transfer", event_kind: "payment_scheduled", payee: "Example",
      account_last4: "1234", amount: 215, due_date: "2026-10-05" } as BillCandidate],
  ])("does not cover %s", (_name, candidate) => {
    expect(findScheduleCoverage(candidate, metadata, null)).toBeNull();
  });

  it("explains posted and upcoming coverage to the owner", () => {
    expect(describeScheduleCoverage({ scheduleId: "reader", name: "Reader App", state: "posted", date: "2026-09-26" }))
      .toBe('Covered by Actual schedule "Reader App" (posted 2026-09-26).');
    expect(describeScheduleCoverage({ scheduleId: "family", name: "Family Cloud", state: "pending_post", date: "2026-10-18" }))
      .toBe('Covered by Actual schedule "Family Cloud" (Actual posts it on 2026-10-18).');
  });
});
