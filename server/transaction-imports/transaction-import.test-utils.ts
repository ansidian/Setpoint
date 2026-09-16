import type { Client } from '@libsql/client';
import type { FinancialEmailPlan } from '../../shared/types/bills.ts';
import { readFinancialProfiles } from '../bills/financial-profiles.ts';
import { projectTransactionImportItem } from './transaction-import-store-projections.ts';
import type { InsertItemInput, TransactionImportStore } from './transaction-import-store.ts';

export async function readImportRun(db: Client, store: TransactionImportStore, userId: string, runId: string) {
  const run = await store.getRun(userId, runId);
  if (!run) return null;
  const rows = await db.execute({ sql: 'SELECT * FROM ea_transaction_import_items WHERE user_id = ? AND run_id = ? ORDER BY created_at, id', args: [userId, runId] });
  return { ...run, items: rows.rows.map(projectTransactionImportItem) };
}

export async function seedProfileAuthorizedImportItems({ db, store, userId, createId, items, automationMode, accounts, plan }: {
  db: Client;
  store: TransactionImportStore;
  userId: string;
  createId: () => string;
  items: Partial<InsertItemInput>[];
  automationMode: 'observe' | 'automatic';
  accounts: Record<'amazon' | 'paypal', string>;
  plan: FinancialEmailPlan;
}) {
  const authorization = plan.profile;
  if (authorization?.status !== 'matched' || !authorization.budgetId) throw new Error('The fixture needs a profile-authorized plan.');
  const runId = createId();
  const savedItems = items.map(item => ({ ...savedImportFixture(), ...item, userId, runId, id: createId() }));
  const configuration = await readFinancialProfiles(userId, { dbClient: db });
  await store.createRun({
    id: runId, userId, trigger: 'arrival', optionsKey: `legacy:${runId}`,
    gmailAccountIds: ['gmail-1'], sources: [...new Set(savedItems.map(item => item.source))],
  });
  for (const item of savedItems) {
    const accountId = accounts[item.source as 'amazon' | 'paypal'];
    const profileId = `${item.source}-profile`;
    configuration.profiles = configuration.profiles.filter(profile => profile.id !== profileId);
    configuration.profiles.push({
      id: profileId, name: `${item.source} receipts`, enabled: true, budgetId: authorization.budgetId,
      senderAddresses: [item.source === 'amazon' ? 'auto-confirm@amazon.com' : 'service@paypal.com'],
      target: { kind: 'expense', accountId, payeeId: `${item.source}-payee` },
    });
    const financialPlan = structuredClone(plan);
    financialPlan.profile = { ...authorization, profileId };
    financialPlan.candidate = { ...financialPlan.candidate, payee: item.payee || undefined, amount: Math.abs(item.amountCents || 0) / 100, due_date: item.date };
    financialPlan.targets.account = { kind: 'account', status: 'resolved', id: accountId, provenance: [] };
    financialPlan.targets.payee = { kind: 'payee', status: 'resolved', id: `${item.source}-payee`, label: item.payee || undefined, provenance: [] };
    financialPlan.targets.category = { kind: 'category', status: 'not_applicable', provenance: [] };
    await store.insertItem({
      ...item, actualAccountId: accountId, financialPlan, actualCategoryId: null, automationMode,
      automaticSafe: Boolean(item.importedId && item.externalId && item.date && item.amountCents
        && item.currency === 'USD' && !item.blockingWarnings.some(warning => (
          typeof warning === 'object' && warning !== null && (warning as { blocking?: boolean }).blocking
        ))),
      status: item.date && item.amountCents && item.payee ? 'queued' : 'needs_review',
    });
  }
  await db.execute({ sql: 'UPDATE ea_settings SET financial_profiles_json = ? WHERE user_id = ?', args: [JSON.stringify(configuration.profiles), userId] });
  await store.updateRunProgress(userId, runId, { status: 'completed', cursor: { complete: true } });
  return { runId };
}

/** Captured legacy rows for recovery tests: parser behavior belongs to the provider registry. */
export function savedImportFixture(overrides: Partial<InsertItemInput> = {}): InsertItemInput {
  return {
    id: "fixture-item", runId: "fixture-run", userId: "owner-1",
    gmailAccountId: "gmail-personal", gmailMessageId: "msg-1", emailUid: "gmail-personal-msg-1",
    emailSubject: "Your Amazon.com order #111-2222222-3333333", internetMessageId: "<sanitized@example.test>",
    candidateKey: "amazon-111-2222222-3333333", source: "amazon", parserVersion: "amazon-v1",
    externalId: "111-2222222-3333333", importedId: "amazon-111-2222222-3333333",
    date: "2026-07-21", amountCents: -2704, currency: "USD", payee: "Amazon", notes: "",
    actualAccountId: null, actualCategoryId: null, automationMode: "automatic", automaticSafe: false,
    blockingWarnings: [], evidence: [], status: "needs_review", ...overrides,
  };
}
