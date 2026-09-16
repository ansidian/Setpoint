import type { FinancialProfile, FinancialProfileDraft } from "../../shared/types/financial-profiles";
import { DEMO_RECEIPT_SENDER } from "./financialReceipt";

/** Unsaved example offered by the managed receipt review. */
export function demoFinancialProfileSuggestion(): FinancialProfileDraft {
  return {
    name: "Fictional Market", budgetId: "demo-budget", senderAddresses: [DEMO_RECEIPT_SENDER],
    merchantName: "Fictional Market", target: { kind: "expense", accountId: "demo-checking", payeeId: "demo-market" },
  };
}

export function updateDemoSettings(
  settings: { financial_profiles: FinancialProfile[]; financial_profiles_revision: number },
  updates: Record<string, unknown>,
) {
  if ('financial_profiles' in updates || 'utility_pay_links' in updates) {
    throw Object.assign(new Error('Use Financial providers to update financial configuration.'), { status: 410 });
  }
  const next = structuredClone(updates);
  delete next.financial_profiles_revision;
  Object.assign(settings, next);
  return { success: true, financial_profiles_revision: settings.financial_profiles_revision };
}
