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
  it("keeps unsettled originals inspectable as saved history without polling or offering retry", () => {
    for (const trigger of ["historical_scan", "arrival"] as const) {
      for (const status of ['queued', 'reconciling', 'importing', 'failed', 'paused', 'needs_review', 'ready'] as const) {
        const saved = item(status, { runTrigger: trigger });
        expect(hasActiveTransactionImport([saved])).toBe(false);
        expect(resolveTransactionImportStatus([saved])).toMatchObject({ title: "Saved receipt", active: false, review: false, recordHref: expect.any(String) });
        saved.correction = { id: 'correction', state: 'recovering', revision: 1 };
        expect(hasActiveTransactionImport([saved])).toBe(true);
        expect(resolveTransactionImportStatus([saved])).toMatchObject({ title: 'Checking correction progress', active: true });
      }
    }
  });

  it('uses the completed correction type ahead of other saved receipts', () => {
    const corrected = item('added', { effectiveResult: { correctionId:'correction-1', entry: { type:'payment', amountCents:1200, date:'2026-09-07', accountId:'account-1' } } });
    expect(resolveTransactionImportStatus([corrected])).toMatchObject({ title:'Corrected in Actual', detail:'The corrected entry is recorded in Actual.', review:false });
    expect(resolveTransactionImportStatus([corrected, item('needs_review')])).toMatchObject({ title:'Corrected in Actual', review:false });
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
  });

  it.each([
    ["added", "Added to Actual"],
    ["updated", "Updated in Actual"],
    ["already_present", "Already in Actual"],
    ["failed", "Saved receipt"],
  ] as const)("projects %s consistently", (status, title) => {
    expect(resolveTransactionImportStatus([item(status)])?.title).toBe(title);
  });
});
