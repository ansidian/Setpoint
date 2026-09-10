import type { FinancialProfile, FinancialProfileDraft } from "../../shared/types/financial-profiles";
import { DEMO_RECEIPT_SENDER } from "./financialReceipt";

/** Fictional configured examples; every edit is discarded on page refresh. */
export function demoFinancialProfiles(): FinancialProfile[] {
  return [
    {
      id: "demo-profile-electric",
      name: "Demo Electric bill",
      enabled: true,
      budgetId: "demo-budget",
      senderAddresses: ["billing@electric.example.test"],
      target: { kind: "utility", scheduleId: "demo-electric" },
    },
    {
      id: "demo-profile-card",
      name: "Everyday Card payment",
      enabled: true,
      budgetId: "demo-budget",
      senderAddresses: ["payments@everyday-card.example.test"],
      accountLast4: "2048",
      target: { kind: "card_payment", fromAccountId: "demo-savings", toAccountId: "demo-credit", scheduleId: "demo-card" },
    },
  ];
}

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
  const next = structuredClone(updates);
  delete next.financial_profiles_revision;
  if ("financial_profiles" in next) {
    if (!Array.isArray(next.financial_profiles)) throw new Error("Financial profiles must be a list.");
    settings.financial_profiles = next.financial_profiles as FinancialProfile[];
    settings.financial_profiles_revision += 1;
    delete next.financial_profiles;
  }
  Object.assign(settings, next);
  return { success: true, financial_profiles_revision: settings.financial_profiles_revision };
}
