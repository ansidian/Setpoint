import { describe, expect, it } from "vitest";
import { hasActiveTransactionImport, resolveTransactionImportStatus } from "./transactionImportStatusModel";
import type { TransactionImportItem } from "../../../../shared/types/transaction-imports";

function item(status: TransactionImportItem["status"], overrides: Partial<TransactionImportItem> = {}): TransactionImportItem {
  return {
    id: "item-1",
    runId: "run-1",
    runTrigger: "arrival",
    gmailAccountId: "gmail-1",
    gmailMessageId: "message-1",
    emailUid: "gmail-gmail-1-message-1",
    emailSubject: "Amazon order",
    internetMessageId: null,
    source: "amazon",
    parserVersion: "amazon-v1",
    externalId: "order-1",
    importedId: "amazon-order-1",
    date: "2026-07-20",
    amountCents: -1200,
    currency: "USD",
    payee: "Amazon",
    notes: "",
    actualAccountId: "account-1",
    actualCategoryId: null,
    automationMode: "automatic",
    automaticSafe: true,
    blockingWarnings: [],
    evidence: [],
    financialPlan: null,
    planShadow: null,
    status,
    reconciliationStatus: null,
    attempts: 1,
    lastError: null,
    confirmedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("transaction import inbox status model", () => {
  it("keeps retired historical work inspectable without polling or offering retry", () => {
    for (const status of ["queued", "failed", "ready"] as const) {
      const saved = item(status, { runTrigger: "historical_scan" });
      expect(hasActiveTransactionImport([saved])).toBe(false);
      expect(resolveTransactionImportStatus([saved])).toMatchObject({ title: "Saved receipt", active: false, review: false, recordHref: expect.any(String) });
    }
  });

  it('uses the completed correction type without hiding another pending receipt', () => {
    const corrected = item('added', { effectiveResult: { correctionId:'correction-1', entry: { type:'payment', amountCents:1200, date:'2026-09-07', accountId:'account-1' } } });
    expect(resolveTransactionImportStatus([corrected])).toMatchObject({ title:'Corrected in Actual', detail:'The corrected entry is recorded in Actual.', review:false });
    expect(resolveTransactionImportStatus([corrected, item('needs_review')])).toMatchObject({ title:'Needs review', review:true });
    corrected.correction = { id:'next', state:'recovering', revision:1 };
    expect(resolveTransactionImportStatus([corrected])).toMatchObject({ title:'Checking correction progress', active:true });
    corrected.correction.state = 'attention';
    expect(resolveTransactionImportStatus([corrected])).toMatchObject({ title:'Correction needs attention', review:true });
    corrected.correction = undefined;
    corrected.effectiveResult!.entry!.type = 'bill';
    expect(resolveTransactionImportStatus([corrected])?.detail).toBe('The corrected schedule is saved in Actual.');
  });

  it('distinguishes a kept Actual result from a correction even without a derived entry', () => {
    const kept = item('added', { id: 'kept', runId: 'run', correction: { id: 'kept-correction', state: 'completed', revision: 2, resolution: 'kept_actual' },
      effectiveResult: { correctionId: 'kept-correction', resolution: 'kept_actual' } });
    expect(resolveTransactionImportStatus([kept])).toMatchObject({ title: 'Current Actual result kept', review: false, active: false, recordHref: expect.stringContaining('view=completed') });
    expect(resolveTransactionImportStatus([kept, item('needs_review')])).toMatchObject({ title: 'Needs review', review: true });
  });

  it.each([
    ["added", "Added to Actual"],
    ["updated", "Updated in Actual"],
    ["already_present", "Already in Actual"],
    ["failed", "Couldn’t sync"],
    ["needs_review", "Needs review"],
    ["importing", "Syncing transaction"],
  ] as const)("projects %s consistently", (status, title) => {
    expect(resolveTransactionImportStatus([item(status)])?.title).toBe(title);
  });

  it("describes observe-mode results as no-write review", () => {
    expect(resolveTransactionImportStatus([
      item("ready", { automationMode: "observe", reconciliationStatus: "would_add" }),
    ])).toMatchObject({
      title: "Needs review",
      detail: "Observed safely; no Actual write was made.",
      review: true,
    });
  });
});
