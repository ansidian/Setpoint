import { describe, expect, it } from "vitest";
import { resolveStatementActualStatus } from "./statementActualStatusModel.ts";

const currentSync = {
  state: "current",
  lastSuccessAt: "2026-07-16T16:00:00.000Z",
};

function bill(overrides = {}) {
  return {
    type: "bill",
    payee: "Acme Utilities",
    payee_id: "payee-acme",
    account_id: "checking",
    amount: 142.31,
    due_date: "2026-08-12",
    ...overrides,
  };
}

function schedule(overrides = {}) {
  return {
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
    ...overrides,
  };
}

describe("resolveStatementActualStatus", () => {
  it("reports an exact Actual schedule occurrence as already scheduled", () => {
    const result = resolveStatementActualStatus({
      bill: bill(),
      metadata: {
        schedules: [schedule()],
        payeeMap: { "payee-acme": "Acme Utilities" },
        accounts: [{ id: "checking", name: "Checking" }],
      },
      occurrences: [{
        id: "schedule-acme:2026-08-12",
        scheduleId: "schedule-acme",
        name: "Acme Utilities",
        payee: "Acme Utilities",
        amount: 142.31,
        next_date: "2026-08-12",
        paid: false,
        type: "bill",
      }],
      transactions: [],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toEqual({
      status: "already_scheduled",
      reason: "exact_schedule_match",
      checkedAt: currentSync.lastSuccessAt,
      evidence: {
        kind: "schedule",
        scheduleId: "schedule-acme",
        name: "Acme Utilities",
        dueDate: "2026-08-12",
        amount: 142.31,
        paid: false,
        type: "bill",
      },
    });
  });

  it("refuses to make a definitive claim from degraded Actual data", () => {
    const result = resolveStatementActualStatus({
      bill: bill(),
      metadata: { schedules: [schedule()] },
      occurrences: [],
      transactions: [],
      syncHealth: {
        state: "degraded",
        lastSuccessAt: "2026-07-15T16:00:00.000Z",
        lastError: "Actual sync timed out",
      },
      today: "2026-07-16",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "actual_data_not_current",
      checkedAt: "2026-07-15T16:00:00.000Z",
      evidence: null,
    });
  });

  it("requires review when the Actual amount conflicts with the statement", () => {
    const result = resolveStatementActualStatus({
      bill: bill(),
      metadata: {
        schedules: [schedule({
          conditions: [
            { op: "is", field: "payee", value: "payee-acme" },
            { op: "is", field: "account", value: "checking" },
            { op: "is", field: "amount", value: -15000 },
          ],
        })],
      },
      occurrences: [{
        scheduleId: "schedule-acme",
        name: "Acme Utilities",
        amount: 150,
        next_date: "2026-08-12",
        paid: false,
        type: "bill",
      }],
      transactions: [],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toEqual({
      status: "needs_review",
      reason: "amount_mismatch",
      checkedAt: currentSync.lastSuccessAt,
      evidence: {
        kind: "schedule",
        scheduleId: "schedule-acme",
        name: "Acme Utilities",
        dueDate: "2026-08-12",
        amount: 150,
        paid: false,
        type: "bill",
        conflicts: ["amount"],
      },
    });
  });

  it("matches an SCE occurrence that includes the configured processing fee", () => {
    const result = resolveStatementActualStatus({
      bill: bill({
        payee: "SCE",
        payee_hint: "SCE",
        amount: 100,
      }),
      metadata: {
        schedules: [schedule({
          name: "SCE",
          conditions: [
            { op: "is", field: "payee", value: "payee-acme" },
            { op: "is", field: "account", value: "checking" },
            { op: "is", field: "amount", value: -10165 },
          ],
        })],
      },
      occurrences: [{
        scheduleId: "schedule-acme",
        name: "SCE",
        amount: 101.65,
        next_date: "2026-08-12",
        paid: false,
        type: "bill",
      }],
      transactions: [],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toMatchObject({
      status: "already_scheduled",
      reason: "exact_schedule_match",
      evidence: {
        amount: 101.65,
        statementAmount: 100,
        adjustment: {
          policyId: "sce-card-fee",
          kind: "fixed_processing_fee",
          amount: 1.65,
        },
      },
    });
  });

  it("accepts either the exact base amount or exact configured-fee total", () => {
    const baseInput = {
      bill: bill({ payee: "SoCalGas", payee_hint: "SoCalGas", amount: 50 }),
      metadata: { schedules: [schedule({ conditions: [
        { op: "is", field: "payee", value: "payee-acme" },
        { op: "is", field: "account", value: "checking" },
        { op: "is", field: "amount", value: -5000 },
      ] })] },
      occurrences: [{
        scheduleId: "schedule-acme",
        amount: 50,
        next_date: "2026-08-12",
        type: "bill",
      }],
      transactions: [],
      syncHealth: currentSync,
      today: "2026-07-16",
    };

    expect(resolveStatementActualStatus(baseInput)).toMatchObject({
      status: "already_scheduled",
      evidence: { amount: 50 },
    });
    expect(resolveStatementActualStatus({
      ...baseInput,
      metadata: { schedules: [schedule({ conditions: [
        { op: "is", field: "payee", value: "payee-acme" },
        { op: "is", field: "account", value: "checking" },
        { op: "is", field: "amount", value: -5150 },
      ] })] },
      occurrences: [{
        scheduleId: "schedule-acme",
        amount: 51.5,
        next_date: "2026-08-12",
        type: "bill",
      }],
    })).toMatchObject({
      status: "already_scheduled",
      evidence: {
        amount: 51.5,
        statementAmount: 50,
        adjustment: { policyId: "socalgas-card-fee", amount: 1.5 },
      },
    });
  });

  it("does not turn configured fees into a fuzzy amount tolerance", () => {
    const result = resolveStatementActualStatus({
      bill: bill({ payee: "SCE", payee_hint: "SCE", amount: 100 }),
      metadata: { schedules: [schedule({ conditions: [
        { op: "is", field: "payee", value: "payee-acme" },
        { op: "is", field: "account", value: "checking" },
        { op: "is", field: "amount", value: -10164 },
      ] })] },
      occurrences: [{
        scheduleId: "schedule-acme",
        amount: 101.64,
        next_date: "2026-08-12",
        type: "bill",
      }],
      transactions: [],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toMatchObject({ status: "needs_review", reason: "amount_mismatch" });
  });

  it("requires review when the matching Actual schedule is on another due date", () => {
    const result = resolveStatementActualStatus({
      bill: bill(),
      metadata: {
        schedules: [schedule({ next_date: "2026-09-12" })],
      },
      occurrences: [{
        scheduleId: "schedule-acme",
        name: "Acme Utilities",
        amount: 142.31,
        next_date: "2026-09-12",
        paid: false,
        type: "bill",
      }],
      transactions: [],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toMatchObject({
      status: "needs_review",
      reason: "due_date_mismatch",
      evidence: {
        scheduleId: "schedule-acme",
        dueDate: "2026-09-12",
        amount: 142.31,
        conflicts: ["due_date"],
      },
    });
  });

  it("requires review when more than one Actual schedule matches exactly", () => {
    const second = schedule({ id: "schedule-acme-2", name: "Acme Utilities backup" });
    const result = resolveStatementActualStatus({
      bill: bill(),
      metadata: { schedules: [schedule(), second] },
      occurrences: [
        { scheduleId: "schedule-acme", next_date: "2026-08-12", amount: 142.31 },
        { scheduleId: "schedule-acme-2", next_date: "2026-08-12", amount: 142.31 },
      ],
      transactions: [],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toEqual({
      status: "needs_review",
      reason: "ambiguous_schedule_match",
      checkedAt: currentSync.lastSuccessAt,
      evidence: {
        kind: "schedule_candidates",
        count: 2,
        scheduleIds: ["schedule-acme", "schedule-acme-2"],
        conflicts: ["identity"],
      },
    });
  });

  it("reports insufficient statement evidence when the due date is missing", () => {
    const result = resolveStatementActualStatus({
      bill: bill({ due_date: null }),
      metadata: { schedules: [schedule()] },
      occurrences: [],
      transactions: [],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "insufficient_statement_evidence",
      evidence: null,
    });
  });

  it("uses a unique exact payee-name match when no Actual IDs were mapped", () => {
    const result = resolveStatementActualStatus({
      bill: bill({ payee_id: undefined, account_id: undefined }),
      metadata: {
        schedules: [schedule()],
        payeeMap: { "payee-acme": "Acme Utilities" },
      },
      occurrences: [{
        scheduleId: "schedule-acme",
        name: "Acme Utilities",
        amount: 142.31,
        next_date: "2026-08-12",
        paid: false,
        type: "bill",
      }],
      transactions: [],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toMatchObject({
      status: "already_scheduled",
      evidence: { scheduleId: "schedule-acme" },
    });
  });

  it("reports an exact due-today Actual transaction as already recorded", () => {
    const result = resolveStatementActualStatus({
      bill: bill({ due_date: "2026-07-16" }),
      metadata: { schedules: [] },
      occurrences: [],
      transactions: [{
        id: "transaction-acme",
        date: "2026-07-16",
        amount: 142.31,
        direction: "expense",
        payee: "Acme Utilities",
        payeeId: "payee-acme",
        account: "Checking",
        accountId: "checking",
        transferAccountId: null,
      }],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toEqual({
      status: "already_recorded",
      reason: "exact_transaction_match",
      checkedAt: currentSync.lastSuccessAt,
      evidence: {
        kind: "transaction",
        transactionId: "transaction-acme",
        name: "Acme Utilities",
        dueDate: "2026-07-16",
        amount: 142.31,
        account: "Checking",
        type: "expense",
      },
    });
  });

  it("requires the exact payee name when only the Actual account is mapped", () => {
    const result = resolveStatementActualStatus({
      bill: bill({ payee_id: undefined, due_date: "2026-07-16" }),
      metadata: { schedules: [] },
      occurrences: [],
      transactions: [{
        id: "transaction-other",
        date: "2026-07-16",
        amount: 142.31,
        direction: "expense",
        payee: "Different Utility",
        payeeId: "payee-other",
        account: "Checking",
        accountId: "checking",
        transferAccountId: null,
      }],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toMatchObject({ status: "not_scheduled", reason: "no_match" });
  });

  it("matches a recorded credit-card transfer by both Actual accounts", () => {
    const result = resolveStatementActualStatus({
      bill: bill({
        type: "transfer",
        payee_id: undefined,
        account_id: undefined,
        from_account_id: "checking",
        to_account_id: "amex",
        schedule_name: "Amex payment",
        due_date: "2026-07-16",
      }),
      metadata: { schedules: [] },
      occurrences: [],
      transactions: [{
        id: "transfer-amex",
        date: "2026-07-16",
        amount: 142.31,
        direction: "expense",
        payee: "Transfer to Amex",
        payeeId: "transfer-payee-amex",
        account: "Checking",
        accountId: "checking",
        transferAccountId: "amex",
      }],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toMatchObject({
      status: "already_recorded",
      evidence: { transactionId: "transfer-amex" },
    });
  });

  it("accepts an exact identity and due date when the statement omits an amount", () => {
    const result = resolveStatementActualStatus({
      bill: bill({ amount: null }),
      metadata: { schedules: [schedule()] },
      occurrences: [{
        scheduleId: "schedule-acme",
        name: "Acme Utilities",
        amount: 142.31,
        next_date: "2026-08-12",
        paid: false,
        type: "bill",
      }],
      transactions: [],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toMatchObject({
      status: "already_scheduled",
      evidence: { scheduleId: "schedule-acme" },
    });
  });

  it("matches a retained occurrence after the recurring schedule has rolled forward", () => {
    const result = resolveStatementActualStatus({
      bill: bill(),
      metadata: {
        schedules: [schedule({
          next_date: "2026-09-12",
          conditions: [
            { op: "is", field: "payee", value: "payee-acme" },
            { op: "is", field: "account", value: "checking" },
            { op: "is", field: "amount", value: -15000 },
          ],
        })],
      },
      occurrences: [{
        scheduleId: "schedule-acme",
        name: "Acme Utilities",
        amount: 142.31,
        next_date: "2026-08-12",
        paid: true,
        type: "bill",
      }],
      transactions: [],
      syncHealth: currentSync,
      today: "2026-07-16",
    });

    expect(result).toMatchObject({
      status: "already_scheduled",
      evidence: {
        dueDate: "2026-08-12",
        amount: 142.31,
        paid: true,
      },
    });
  });
});
