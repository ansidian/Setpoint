import type {
  TransactionImportItem,
  TransactionImportRunDetail,
} from "../../shared/types/transaction-imports";
import type { DashboardFinanceActivity, DashboardFinanceActivityItem } from "../../shared/types/dashboard-finance";
import type { DemoSeed } from "./store.ts";
import { recordDemoImportedTransaction } from "./financeData.ts";

export const NO_DEMO_TRANSACTION_IMPORT_RESPONSE = Symbol("NO_DEMO_TRANSACTION_IMPORT_RESPONSE");

const clone = <T>(value: T): T => value == null ? value : structuredClone(value);
const now = Date.now();

const item: TransactionImportItem = {
  id: "demo-transaction-item-1",
  runId: "demo-transaction-run-1",
  gmailAccountId: "demo-gmail",
  gmailMessageId: "demo-paypal-message",
  emailUid: "demo-email-paypal-receipt",
  emailSubject: "You paid Fictional Cloud Tools $18.00",
  internetMessageId: "<demo-paypal@example.invalid>",
  source: "paypal",
  parserVersion: "paypal-v1",
  externalId: "DEMO123456789012345",
  importedId: "paypal-DEMO123456789012345",
  date: new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
  amountCents: -1800,
  currency: "USD",
  payee: "Fictional Cloud Tools",
  notes: "PayPal demo receipt",
  actualAccountId: "demo-checking",
  actualCategoryId: "demo-cloud-services",
  automationMode: "observe",
  automaticSafe: true,
  blockingWarnings: [],
  evidence: [{ code: "demo_fixture", value: "fictional" }],
  financialPlan: null,
  planShadow: null,
  status: "ready",
  reconciliationStatus: "would_add",
  attempts: 1,
  lastError: null,
  confirmedAt: null,
  createdAt: now,
  updatedAt: now,
};

let runs: TransactionImportRunDetail[] = [{
  id: "demo-transaction-run-1",
  trigger: "historical_scan",
  status: "completed",
  gmailAccountIds: ["demo-gmail"],
  sources: ["paypal"],
  startDate: new Date(now - 30 * 86_400_000).toISOString().slice(0, 10),
  endDate: new Date(now).toISOString().slice(0, 10),
  cursor: { complete: true },
  counts: { discovered: 2, parsed: 2, review: 1, queued: 0, added: 1, updated: 0, duplicate: 0, failed: 0 },
  attempts: 1,
  lastError: null,
  createdAt: now,
  updatedAt: now,
  items: [item, { ...item, id: "demo-transaction-item-automatic", emailUid: "demo-email-cloud-receipt", emailSubject: "You paid Cloud Sandbox $38.47", gmailMessageId: "demo-cloud-message", internetMessageId: "<demo-cloud@example.invalid>", externalId: "DEMO_CLOUD_3847", importedId: "paypal-DEMO_CLOUD_3847", payee: "Cloud Sandbox", amountCents: -3847, automationMode: "automatic", status: "added", reconciliationStatus: "added", updatedAt: now - 600_000 }],
}];

function needsReview(entry: TransactionImportItem) {
  return ["needs_review", "failed", "paused"].includes(entry.status)
    || (entry.status === "ready" && !entry.confirmedAt && (entry.automationMode === "observe" || !entry.automaticSafe));
}

export function getDemoFinanceActivity(): DashboardFinanceActivity {
  const items = runs.flatMap((run) => run.items);
  const review = items.filter(needsReview);
  const recent = items.filter((entry) => entry.automationMode === "automatic" && !entry.confirmedAt && ["added", "updated", "already_present"].includes(entry.status));
  const project = (entry: TransactionImportItem): DashboardFinanceActivityItem => ({
    id: entry.id, runId: entry.runId, emailUid: entry.emailUid, payee: entry.payee, amountCents: entry.amountCents, currency: entry.currency,
    status: entry.status as DashboardFinanceActivityItem["status"], updatedAt: entry.updatedAt,
    description: entry.status === "added" ? "Imported into Actual" : entry.status === "already_present" ? "Already recorded in Actual" : entry.status === "updated" ? "Updated in Actual" : entry.status === "ready" ? "Ready for your confirmation" : entry.status === "failed" ? "Import needs a retry" : "Review the source evidence",
  });
  return { status: "ready", reviewCount: review.length, review: review.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3).map(project), recent: recent.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3).map(project), error: null };
}

export function handleDemoTransactionImportRequest({
  pathname,
  method,
  url,
  body,
  seed,
}: {
  pathname: string;
  method: string;
  url: URL;
  body: Record<string, unknown>;
  seed: DemoSeed;
}): unknown {
  if (pathname === "/api/dashboard/finance/review-runs" && method === "GET") {
    const requestedOffset = Number(url.searchParams.get("offset") || 0);
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
    const pending = runs.filter((run) => run.items.some(needsReview))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { runs: clone(pending.slice(offset, offset + 12).map(({ items: _items, ...run }) => run)), total: pending.length, offset };
  }
  if (method === "GET" && (pathname === "/api/briefing/email/demo-email-paypal-receipt" || pathname === "/api/briefing/email/demo-email-cloud-receipt")) {
    const automatic = pathname.endsWith("demo-email-cloud-receipt");
    return {
      uid: automatic ? "demo-email-cloud-receipt" : "demo-email-paypal-receipt",
      body: `Fictional PayPal demo receipt. You paid ${automatic ? "Cloud Sandbox $38.47" : "Fictional Cloud Tools $18.00"}. Paid from Demo Checking. This is sample receipt evidence only; no real payment or provider connection exists.`,
      attachments: [],
    };
  }
  if (!pathname.startsWith("/api/briefing/transaction-imports/")) {
    return NO_DEMO_TRANSACTION_IMPORT_RESPONSE;
  }
  if (pathname.endsWith("/runs") && method === "GET") {
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 12)));
    return { runs: clone(runs.slice(0, limit).map(({ items: _items, ...run }) => run)) };
  }
  if (pathname.endsWith("/runs") && method === "POST") {
    const runId = `demo-transaction-run-${Date.now()}`;
    const createdAt = Date.now();
    const run: TransactionImportRunDetail = {
      id: runId,
      trigger: "historical_scan",
      status: "completed",
      gmailAccountIds: Array.isArray(body.gmailAccountIds) ? body.gmailAccountIds.map(String) : ["demo-gmail"],
      sources: Array.isArray(body.sources)
        ? body.sources.filter((source): source is "amazon" | "paypal" => source === "amazon" || source === "paypal")
        : ["amazon", "paypal"],
      startDate: typeof body.startDate === "string" ? body.startDate : null,
      endDate: typeof body.endDate === "string" ? body.endDate : null,
      cursor: { complete: true, demo: true },
      counts: { discovered: 0, parsed: 0, review: 0, queued: 0, added: 0, updated: 0, duplicate: 0, failed: 0 },
      attempts: 1,
      lastError: null,
      createdAt,
      updatedAt: createdAt,
      items: [],
    };
    runs = [run, ...runs];
    return { runId, created: true };
  }
  const runMatch = pathname.match(/\/runs\/([^/]+)$/);
  if (runMatch && method === "GET") {
    const run = runs.find((entry) => entry.id === decodeURIComponent(runMatch[1]!));
    return run ? clone(run) : null;
  }
  const commitMatch = pathname.match(/\/runs\/([^/]+)\/commit$/);
  if (commitMatch && method === "POST") {
    const runId = decodeURIComponent(commitMatch[1]!);
    const confirmations = Array.isArray(body.items) ? body.items : [];
    let accepted = 0;
    runs = runs.map((run) => {
      if (run.id !== runId) return run;
      const choices = new Map(confirmations.flatMap((entry) => entry && typeof entry === "object" && "itemId" in entry
        ? [[String(entry.itemId || ""), entry as Record<string, unknown>] as const] : []));
      const items = run.items.map((candidate) => {
        const choice = choices.get(candidate.id);
        if (!choice || !needsReview(candidate) || candidate.confirmedAt != null) return candidate;
        accepted++;
        const confirmed = { ...candidate,
          date: typeof choice.date === "string" ? choice.date : candidate.date,
          amountCents: typeof choice.amountCents === "number" && Number.isFinite(choice.amountCents) ? choice.amountCents : candidate.amountCents,
          payee: typeof choice.payee === "string" ? choice.payee : candidate.payee,
          notes: typeof choice.notes === "string" ? choice.notes : candidate.notes,
          actualAccountId: typeof choice.actualAccountId === "string" ? choice.actualAccountId : candidate.actualAccountId,
          actualCategoryId: typeof choice.actualCategoryId === "string" || choice.actualCategoryId === null ? choice.actualCategoryId : candidate.actualCategoryId,
          status: "added" as const, reconciliationStatus: "added" as const, confirmedAt: Date.now(), updatedAt: Date.now() };
        recordDemoImportedTransaction(seed, confirmed);
        return confirmed;
      });
      return { ...run, items, counts: { ...run.counts, added: run.counts.added + accepted, review: Math.max(0, run.counts.review - accepted) }, updatedAt: Date.now() };
    });
    return { accepted };
  }
  const itemActionMatch = pathname.match(/\/items\/([^/]+)\/(retry|dismiss)$/);
  if (itemActionMatch && method === "POST") {
    const itemId = decodeURIComponent(itemActionMatch[1]!);
    const action = itemActionMatch[2]!;
    let changed = false;
    runs = runs.map((run) => ({
      ...run,
      items: run.items.map((candidate) => {
        if (candidate.id !== itemId) return candidate;
        changed = true;
        return {
          ...candidate,
          status: action === "dismiss" ? "dismissed" as const : "ready" as const,
          reconciliationStatus: action === "dismiss" ? candidate.reconciliationStatus : "would_add" as const,
          updatedAt: Date.now(),
        };
      }),
    }));
    return action === "dismiss" ? { dismissed: changed } : { accepted: changed };
  }
  if (pathname.endsWith("/email-status") && method === "GET") {
    const emailUid = url.searchParams.get("emailUid") || "";
    return { emailUid, items: clone(runs.flatMap((run) => run.items).filter((candidate) => candidate.emailUid === emailUid)) };
  }
  return NO_DEMO_TRANSACTION_IMPORT_RESPONSE;
}
