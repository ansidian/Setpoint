import type {
  TransactionImportItem,
  TransactionImportRunDetail,
} from "../../shared/types/transaction-imports";

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
  date: new Date().toISOString().slice(0, 10),
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
  counts: { discovered: 8, parsed: 3, review: 1, queued: 0, added: 0, updated: 0, duplicate: 2, failed: 0 },
  attempts: 1,
  lastError: null,
  createdAt: now,
  updatedAt: now,
  items: [item],
}];

export function handleDemoTransactionImportRequest({
  pathname,
  method,
  url,
  body,
}: {
  pathname: string;
  method: string;
  url: URL;
  body: Record<string, unknown>;
}): unknown {
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
      const ids = new Set(confirmations.map((entry) => String(
        entry && typeof entry === "object" && "itemId" in entry ? entry.itemId || "" : "",
      )));
      const items = run.items.map((candidate) => {
        if (!ids.has(candidate.id)) return candidate;
        accepted++;
        return { ...candidate, status: "added" as const, reconciliationStatus: "added" as const, confirmedAt: Date.now(), updatedAt: Date.now() };
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
