import { randomUUID } from "crypto";
import { parseTransactionEmail } from "./parsers/parser-registry.ts";
import { projectAutomaticSafety, type TransactionEmailInput } from "./transaction-import-types.ts";
import { transactionImportStore, type InsertItemInput, type TransactionImportStore } from "./transaction-import-store.ts";
import type {
  TransactionImportConfirmation,
  TransactionImportMapping,
  TransactionImportSource,
} from "../../shared/types/transaction-imports.ts";

export interface HistoricalScanOptions {
  gmailAccountIds: string[];
  sources: TransactionImportSource[];
  startDate: string;
  endDate: string;
}

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

export function historicalScanOptionsKey(options: HistoricalScanOptions): string {
  return JSON.stringify({
    gmailAccountIds: normalizedUnique(options.gmailAccountIds),
    sources: normalizedUnique(options.sources),
    startDate: options.startDate,
    endDate: options.endDate,
  });
}

function validateHistoricalOptions(options: HistoricalScanOptions): HistoricalScanOptions {
  const gmailAccountIds = normalizedUnique(options.gmailAccountIds);
  const sources = normalizedUnique(options.sources) as TransactionImportSource[];
  if (!gmailAccountIds.length) throw Object.assign(new Error("At least one Gmail account is required"), { status: 400 });
  if (!sources.length || sources.some((source) => source !== "amazon" && source !== "paypal")) {
    throw Object.assign(new Error("At least one supported transaction source is required"), { status: 400 });
  }
  const start = new Date(`${options.startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${options.endDate}T00:00:00.000Z`).getTime();
  if (!isValidYmd(options.startDate) || !isValidYmd(options.endDate)
    || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw Object.assign(new Error("A valid increasing scan date range is required"), { status: 400 });
  }
  return { gmailAccountIds, sources, startDate: options.startDate, endDate: options.endDate };
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
  mappings: TransactionImportMapping[],
  createId: () => string = randomUUID,
  { includeOffAsObserve = false }: { includeOffAsObserve?: boolean } = {},
): PreparedItems {
  const mappingBySource = new Map(mappings.map((mapping) => [mapping.source, mapping]));
  const items: InsertItemInput[] = [];
  let parsed = 0;
  let review = 0;
  let queued = 0;

  for (const email of emails) {
    const result = parseTransactionEmail(email);
    if (result.kind === "unmatched") continue;
    const source = result.source;
    if (!source) continue;
    const mapping = mappingBySource.get(source);
    if (!mapping || mapping.mode === "off" && !includeOffAsObserve) continue;
    const automationMode = mapping.mode === "automatic" ? "automatic" : "observe";
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
        actualAccountId: mapping.actualAccountId,
        actualCategoryId: mapping.actualCategoryId,
        automationMode,
        automaticSafe: false,
        blockingWarnings: result.reasons.map((reason) => ({ code: reason, blocking: true })),
        evidence: result.reasons.map((reason) => ({ code: "parse_failure", value: reason })),
        status: "needs_review",
      });
      continue;
    }

    result.candidates.forEach((candidate, candidateIndex) => {
      const safety = projectAutomaticSafety(candidate);
      const automaticSafe = safety.safe && Boolean(mapping.actualAccountId);
      const status = mapping.actualAccountId ? "queued" : "needs_review";
      if (status === "queued") queued++;
      else review++;
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
        actualAccountId: mapping.actualAccountId,
        actualCategoryId: mapping.actualCategoryId,
        automationMode,
        automaticSafe,
        blockingWarnings: [
          ...candidate.warnings,
          ...(!mapping.actualAccountId ? [{ code: "missing_mapping", blocking: true }] : []),
        ],
        evidence: candidate.evidence,
        status,
      });
    });
  }
  return { items, parsed, review, queued };
}

export function createTransactionImportService({
  store = transactionImportStore,
  createId = randomUUID,
}: { store?: TransactionImportStore; createId?: () => string } = {}) {
  async function startHistoricalScan(userId: string, rawOptions: HistoricalScanOptions): Promise<{ runId: string; created: boolean }> {
    const options = validateHistoricalOptions(rawOptions);
    const result = await store.createRun({
      id: createId(),
      userId,
      trigger: "historical_scan",
      optionsKey: historicalScanOptionsKey(options),
      gmailAccountIds: options.gmailAccountIds,
      sources: options.sources,
      startDate: options.startDate,
      endDate: options.endDate,
    });
    if (!result.created && result.run.status === "paused") await store.resumePausedRun(userId, result.run.id);
    return { runId: result.run.id, created: result.created };
  }

  async function ingestArrivals(userId: string, emails: TransactionEmailInput[]): Promise<{ queued: number; review: number; runId: string | null }> {
    if (!emails.length) return { queued: 0, review: 0, runId: null };
    const mappings = await store.listMappings(userId);
    const runId = createId();
    const prepared = prepareTransactionImportItems(userId, runId, emails, mappings, createId);
    if (!prepared.items.length) return { queued: 0, review: 0, runId: null };
    await store.createRun({
      id: runId,
      userId,
      trigger: "arrival",
      optionsKey: `arrival:${runId}`,
      gmailAccountIds: normalizedUnique(emails.map((email) => email.gmailAccountId)),
      sources: normalizedUnique(prepared.items.map((item) => item.source)) as TransactionImportSource[],
      startDate: null,
      endDate: null,
    });
    let inserted = 0;
    for (const item of prepared.items) {
      if (await store.insertItem(item)) inserted++;
    }
    await store.updateRunProgress(userId, runId, {
      cursor: { complete: true },
      status: "completed",
      discovered: emails.length,
      parsed: prepared.parsed,
      review: prepared.review,
      queued: prepared.queued,
    });
    return { queued: Math.min(prepared.queued, inserted), review: prepared.review, runId };
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
    startHistoricalScan,
    ingestArrivals,
    getRun: store.getRunDetail,
    listRuns: store.listRuns,
    listItemsForEmail: store.listItemsForEmail,
    listMappings: store.listMappings,
    upsertMapping: store.upsertMapping,
    commitItems,
    retryItem,
    dismissItem,
  };
}

export const transactionImportService = createTransactionImportService();
