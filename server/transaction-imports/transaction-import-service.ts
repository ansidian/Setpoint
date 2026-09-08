import { randomUUID } from "crypto";
import { parseTransactionEmail } from "./parsers/parser-registry.ts";
import { type TransactionEmailInput } from "./transaction-import-types.ts";
import { transactionImportStore, type InsertItemInput, type TransactionImportStore } from "./transaction-import-store.ts";
import type {
  TransactionImportConfirmation,
  TransactionImportSource,
} from "../../shared/types/transaction-imports.ts";
import { planTransactionImportItems } from "./transaction-import-planner-adapter.ts";

function normalizedUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function isValidYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

interface PreparedItems {
  items: InsertItemInput[];
  parsed: number;
  review: number;
  queued: number;
}

export function prepareTransactionImportItems(
  userId: string,
  runId: string,
  emails: TransactionEmailInput[],
  createId: () => string = randomUUID,
): PreparedItems {
  const items: InsertItemInput[] = [];
  let parsed = 0;
  let review = 0;
  const queued = 0;

  for (const email of emails) {
    const result = parseTransactionEmail(email);
    if (result.kind === "unmatched") continue;
    const source = result.source;
    if (!source) continue;
    parsed++;

    if (result.kind === "rejected") {
      review++;
      items.push({
        id: createId(),
        runId,
        userId,
        gmailAccountId: email.gmailAccountId,
        gmailMessageId: email.gmailMessageId,
        emailUid: email.uid,
        emailSubject: email.subject.slice(0, 500),
        internetMessageId: email.internetMessageId ?? null,
        candidateKey: `rejected:${source}:${email.gmailMessageId}`,
        source,
        parserVersion: `${source}-rejected-v1`,
        externalId: null,
        importedId: null,
        date: null,
        amountCents: null,
        currency: "USD",
        payee: null,
        notes: "",
        actualAccountId: null,
        actualCategoryId: null,
        automationMode: "automatic",
        automaticSafe: false,
        blockingWarnings: result.reasons.map((reason) => ({ code: reason, blocking: true })),
        evidence: result.reasons.map((reason) => ({ code: "parse_failure", value: reason })),
        status: "needs_review",
      });
      continue;
    }

    result.candidates.forEach((candidate, candidateIndex) => {
      review++;
      items.push({
        id: createId(),
        runId,
        userId,
        gmailAccountId: candidate.gmailAccountId,
        gmailMessageId: candidate.gmailMessageId,
        emailUid: candidate.emailUid,
        emailSubject: email.subject.slice(0, 500),
        internetMessageId: candidate.internetMessageId,
        candidateKey: candidate.importedId || `candidate:${candidate.gmailMessageId}:${candidateIndex}`,
        source: candidate.source,
        parserVersion: candidate.parserVersion,
        externalId: candidate.externalId,
        importedId: candidate.importedId,
        date: candidate.date,
        amountCents: candidate.amountCents,
        currency: candidate.currency,
        payee: candidate.payee,
        notes: candidate.notes,
        actualAccountId: null,
        actualCategoryId: null,
        automationMode: "automatic",
        automaticSafe: false,
        blockingWarnings: candidate.warnings,
        evidence: candidate.evidence,
        status: "needs_review",
      });
    });
  }
  return { items, parsed, review, queued };
}

export function createTransactionImportService({
  store = transactionImportStore,
  createId = randomUUID,
  planItems = planTransactionImportItems,
}: {
  store?: TransactionImportStore;
  createId?: () => string;
  planItems?: typeof planTransactionImportItems;
} = {}) {
  async function ingestArrivals(userId: string, emails: TransactionEmailInput[]): Promise<{ queued: number; review: number; runId: string | null }> {
    if (!emails.length) return { queued: 0, review: 0, runId: null };
    const managed = new Set(await store.listManagedEmailUids(userId, emails.map((email) => email.uid)));
    const legacyEmails = emails.filter((email) => !managed.has(email.uid));
    if (!legacyEmails.length) return { queued: 0, review: 0, runId: null };
    const runId = createId();
    const prepared = prepareTransactionImportItems(userId, runId, legacyEmails, createId);
    if (!prepared.items.length) return { queued: 0, review: 0, runId: null };
    const plannedItems = await planItems(userId, prepared.items);
    await store.createRun({
      id: runId,
      userId,
      trigger: "arrival",
      optionsKey: `arrival:${runId}`,
      gmailAccountIds: normalizedUnique(legacyEmails.map((email) => email.gmailAccountId)),
      sources: normalizedUnique(prepared.items.map((item) => item.source)) as TransactionImportSource[],
    });
    let queued = 0;
    let review = 0;
    let duplicate = 0;
    for (const item of plannedItems) {
      if (await store.insertItem(item)) {
        if (item.status === "queued") queued++;
        else if (item.status === "already_present") duplicate++;
        else review++;
      }
    }
    await store.updateRunProgress(userId, runId, {
      cursor: { complete: true },
      status: "completed",
      discovered: legacyEmails.length,
      parsed: prepared.parsed,
      review,
      queued,
    });
    if (duplicate) await store.incrementRunOutcomes(userId, runId, { duplicate });
    return { queued, review, runId };
  }

  async function commitItems(
    userId: string,
    runId: string,
    confirmations: TransactionImportConfirmation[],
  ): Promise<{ accepted: number }> {
    if (!await store.getRun(userId, runId)) throw Object.assign(new Error("Transaction import run not found"), { status: 404 });
    if (!Array.isArray(confirmations) || !confirmations.length || confirmations.length > 100) {
      throw Object.assign(new Error("One to 100 transaction import items are required"), { status: 400 });
    }
    const seen = new Set<string>();
    let accepted = 0;
    for (const confirmation of confirmations) {
      if (!confirmation || typeof confirmation.itemId !== "string" || !confirmation.itemId || seen.has(confirmation.itemId)) {
        throw Object.assign(new Error("Transaction import item IDs must be non-empty and unique"), { status: 400 });
      }
      seen.add(confirmation.itemId);
      const item = await store.getItem(userId, confirmation.itemId);
      if (!item || item.runId !== runId) throw Object.assign(new Error("Transaction import item not found"), { status: 404 });
      const date = confirmation.date ?? item.date;
      const amountCents = confirmation.amountCents ?? item.amountCents;
      const payee = confirmation.payee ?? item.payee;
      const notes = confirmation.notes ?? item.notes;
      const actualAccountId = confirmation.actualAccountId ?? item.actualAccountId;
      const actualCategoryId = confirmation.actualCategoryId === undefined ? item.actualCategoryId : confirmation.actualCategoryId;
      if (!date || !isValidYmd(date)) {
        throw Object.assign(new Error("Transaction date must be a valid YYYY-MM-DD value"), { status: 400 });
      }
      if (!Number.isSafeInteger(amountCents) || amountCents === 0) {
        throw Object.assign(new Error("Transaction amountCents must be a nonzero integer"), { status: 400 });
      }
      if (item.currency !== "USD") throw Object.assign(new Error("Only USD transaction candidates can be confirmed"), { status: 400 });
      if (typeof payee !== "string" || !payee.trim() || payee.length > 200) {
        throw Object.assign(new Error("Transaction payee is required and must be at most 200 characters"), { status: 400 });
      }
      if (typeof notes !== "string" || notes.length > 2_000) {
        throw Object.assign(new Error("Transaction notes must be at most 2000 characters"), { status: 400 });
      }
      if (typeof actualAccountId !== "string" || !actualAccountId.trim() || actualAccountId.length > 200) {
        throw Object.assign(new Error("An Actual account ID is required"), { status: 400 });
      }
      if (actualCategoryId != null && (typeof actualCategoryId !== "string" || !actualCategoryId.trim() || actualCategoryId.length > 200)) {
        throw Object.assign(new Error("Actual category ID is invalid"), { status: 400 });
      }
      if (await store.confirmItem(userId, runId, item.id, {
        date,
        amountCents: amountCents as number,
        payee: payee.trim(),
        notes,
        actualAccountId: actualAccountId.trim(),
        actualCategoryId,
      })) accepted++;
    }
    return { accepted };
  }

  async function retryItem(userId: string, itemId: string): Promise<{ accepted: boolean }> {
    if (!await store.getItem(userId, itemId)) throw Object.assign(new Error("Transaction import item not found"), { status: 404 });
    return { accepted: await store.retryItem(userId, itemId) };
  }

  async function dismissItem(userId: string, itemId: string): Promise<{ dismissed: boolean }> {
    if (!await store.getItem(userId, itemId)) throw Object.assign(new Error("Transaction import item not found"), { status: 404 });
    return { dismissed: await store.dismissItem(userId, itemId) };
  }

  return {
    ingestArrivals,
    listItemsForEmail: store.listItemsForEmail,
    commitItems,
    retryItem,
    dismissItem,
  };
}

export const transactionImportService = createTransactionImportService();
