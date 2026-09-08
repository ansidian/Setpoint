import type { FinancialActivity, FinancialActivityReference } from "../../shared/types/financial-activity";
import { getDemoImportRuns } from "./transactionImports";
import { demoReviewActivity } from "./financialCompletion";
import { handleDemoCorrection, projectDemoCorrection } from "./financialCorrections";
import { withDemoFinancialHistory } from "./financialHistory";
import { getDemoSeed } from "./store";
import type { DemoRequestBody } from "./apiHandler";
import { demoNotFound } from "./apiHandler";

export function getDemoFinancialActivities(): FinancialActivity[] {
  const imported = getDemoImportRuns().flatMap((run) => run.items.map((item): FinancialActivity => {
    const reference: FinancialActivityReference = { owner: "import", id: item.id, runId: run.id };
    const completed = ["added", "updated", "already_present"].includes(item.status);
    const attention = ["ready", "needs_review", "failed", "paused"].includes(item.status) && !completed;
    return { id: JSON.stringify(["import", item.source, item.importedId]), reference, occurrences: [reference], source: item.source,
      contexts: [run.trigger], emailUids: [item.emailUid], subject: item.emailSubject, payee: item.payee,
      amountCents: item.amountCents, currency: item.currency, createdAt: item.createdAt, updatedAt: item.updatedAt,
      status: completed ? "completed" : attention ? "needs_attention" : item.status === "dismissed" ? "dismissed" : "processing",
      reason: item.lastError || item.status.replace(/_/g, " "),
      actions: { complete: attention, retry: ["failed", "paused"].includes(item.status), inspect: true, correct: completed },
      originalReceipts: completed ? [{ reference, revision: null, capturedAt: item.updatedAt, captureKind: "historical",
        outcome: item.status, input: { type: "payment", amountCents: Math.abs(item.amountCents || 0), date: item.date, accountId: item.actualAccountId }, result: { transactionId: item.id }, evidence: { budgetId: "demo-budget", objects: [{ kind: "transaction", id: item.id, role: "primary", provenance: "created", beforeState: "confirmed_absent", before: null, after: { id: item.id, amount: item.amountCents, date: Number((item.date || getDemoSeed().dateKey).replace(/-/g, "")), acct: item.actualAccountId, description: `demo-payee-${item.id}`, category: item.actualCategoryId, notes: item.notes } }] } }] : [],
      sourceEvidence: item.evidence, targetBindings: [], liveState: "not_checked", effectiveResult: null,
      completionPlan: item.financialPlan, importItem: item, runs: [run] };
  }));
  const base = imported[0]!;
  const examples: Array<[string, FinancialActivity["status"], string]> = [
    ["demo-event-schedule", "completed", "Utility schedule updated; original before-image was not captured."],
    ["demo-event-disconnected", "completed", "Saved utility result. Its original budget is currently disconnected."],
    ["demo-event-transfer", "completed", "Transfer recorded from Demo Checking to Emergency Fund."],
    ["demo-event-partial", "needs_attention", "The bill amount and due date are saved. Its note still needs attention."],
    ["demo-event-pending", "processing", "Checking current Actual activity."],
    ["demo-event-uncertain", "needs_attention", "The previous write could not be verified. Review Actual before continuing."],
  ];
  return [...imported, demoReviewActivity(base), ...examples.map(([id, status, reason], index): FinancialActivity => {
    const reference: FinancialActivityReference = { owner: "event", id };
    const scheduleId = id === "demo-event-uncertain" ? "demo-uncertain-schedule" : "demo-shared-schedule";
    const payee = id === "demo-event-transfer" ? "Savings transfer" : id === "demo-event-uncertain" ? "Fictional Water" : "Fictional Electric";
    const createdAt = base.createdAt - (index + 1) * 86400000;
    const ruleId = id === "demo-event-uncertain" ? "demo-uncertain-rule" : "demo-schedule-rule";
    return { ...base, id: JSON.stringify(["event", id]), reference, occurrences: [reference], source: "managed", contexts: ["arrival"],
      emailUids: [], subject: id === "demo-event-disconnected" ? "Utility statement · disconnected budget" : id === "demo-event-transfer" ? "Transfer to savings" : "Fictional utility statement", payee, amountCents: id === "demo-event-transfer" ? -25000 : -8200,
      createdAt, status, reason,
      actions: { complete: false, retry: false, inspect: true, correct: status === "completed" },
      originalReceipts: status === "completed" || id === "demo-event-partial" || id === "demo-event-uncertain" ? [{ reference, revision: 1, capturedAt: createdAt + 2 * 60_000,
        captureKind: "historical", outcome: id === "demo-event-transfer" ? "added" : "updated", input: id === "demo-event-transfer" ? { type: "transfer", amountCents: 25000, fromAccountId: "demo-checking", toAccountId: "demo-savings" } : { type: "bill", amountCents: 8200, accountId: "demo-checking" }, result: id === "demo-event-transfer" ? { transactionId: "demo-transfer-from", budgetId: "demo-budget" } : { scheduleId, budgetId: "demo-budget" }, evidence: { budgetId: "demo-budget", objects: id === "demo-event-transfer" ? [
          { kind: "transaction", id: "demo-transfer-from", role: "primary", provenance: "created", beforeState: "confirmed_absent", before: null, after: { id: "demo-transfer-from", acct: "demo-checking", description: null, amount: -25000, date: Number(getDemoSeed().dateKey.replace(/-/g, "")), transferred_id: "demo-transfer-to" } },
          { kind: "transaction", id: "demo-transfer-to", role: "counterpart", provenance: "created", beforeState: "confirmed_absent", before: null, after: { id: "demo-transfer-to", acct: "demo-savings", description: null, amount: 25000, date: Number(getDemoSeed().dateKey.replace(/-/g, "")), transferred_id: "demo-transfer-from" } }
        ] : [{ kind: "schedule", id: scheduleId, role: "primary", provenance: "updated", beforeState: "unknown", before: null, after: { id: scheduleId, name: payee, rule: ruleId, tombstone: 0 } }] } }] : [],
      sourceEvidence: [], targetBindings: [], completionPlan: null, importItem: null, runs: [] };
  })].map(activity => withDemoFinancialHistory(projectDemoCorrection(activity))).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function handleDemoFinancialActivity(url: URL, method: string, body: DemoRequestBody = {}): unknown {
  if (url.pathname.startsWith("/api/briefing/financial-corrections/")) return handleDemoCorrection(url, method, body, getDemoFinancialActivities());
  if (method === "POST" && url.pathname === "/api/briefing/financial-activity/binding") return { status: "unavailable", evidence: null };
  if (method !== "GET") return demoNotFound(url.pathname);
  const all = getDemoFinancialActivities();
  if (url.pathname === "/api/briefing/financial-activity") {
    const query = url.searchParams;
    const items = all.filter((item) => (!query.get("view") || query.get("view") === "all" || item.status === query.get("view"))
      && (!query.get("source") || item.source === query.get("source"))
      && (!query.get("context") || item.contexts.includes(query.get("context") as "arrival" | "historical_scan"))
      && (!query.get("runId") || item.runs.some((run) => run.id === query.get("runId"))));
    const offset = Number(query.get("offset") || 0);
    return structuredClone({ items: items.slice(offset, offset + 20).map(({ history: _history, ...item }) => item), total: items.length, offset, limit: 20 });
  }
  const [owner, id] = url.pathname.split("/").slice(-2).map(decodeURIComponent);
  const item = all.find((entry) => entry.occurrences.some((ref) => ref.owner === owner && ref.id === id
    && (ref.owner !== "import" || ref.runId === url.searchParams.get("runId"))));
  return item ? structuredClone(item) : demoNotFound(url.pathname);
}
