import type { FinancialActivity, FinancialActivityReference } from "../../shared/types/financial-activity";
import { getDemoImportRuns } from "./transactionImports";
import { demoNotFound } from "./apiHandler";

function activities(): FinancialActivity[] {
  const imported = getDemoImportRuns().flatMap((run) => run.items.map((item): FinancialActivity => {
    const reference: FinancialActivityReference = { owner: "import", id: item.id, runId: run.id };
    const completed = ["added", "updated", "already_present"].includes(item.status);
    const attention = ["ready", "needs_review", "failed", "paused"].includes(item.status) && !completed;
    return { id: JSON.stringify(["import", item.source, item.importedId]), reference, occurrences: [reference], source: item.source,
      contexts: [run.trigger], emailUids: [item.emailUid], subject: item.emailSubject, payee: item.payee,
      amountCents: item.amountCents, currency: item.currency, createdAt: item.createdAt, updatedAt: item.updatedAt,
      status: completed ? "completed" : attention ? "needs_attention" : item.status === "dismissed" ? "dismissed" : "processing",
      reason: item.lastError || item.status.replace(/_/g, " "),
      actions: { complete: attention, retry: ["failed", "paused"].includes(item.status), inspect: true, correct: false },
      originalReceipts: completed ? [{ reference, revision: null, capturedAt: item.updatedAt, captureKind: "historical",
        outcome: item.status, input: null, result: null, evidence: null }] : [],
      sourceEvidence: item.evidence, targetBindings: [], liveState: "not_checked", effectiveResult: null,
      completionPlan: item.financialPlan, importItem: item, runs: [run] };
  }));
  const base = imported[0]!;
  const examples: Array<[string, FinancialActivity["status"], string]> = [
    ["demo-event-schedule", "completed", "Utility schedule updated; original before-image was not captured."],
    ["demo-event-pending", "processing", "Checking current Actual activity."],
    ["demo-event-uncertain", "needs_attention", "The previous write could not be verified. Review Actual before continuing."],
  ];
  return [...imported, ...examples.map(([id, status, reason], index): FinancialActivity => {
    const reference: FinancialActivityReference = { owner: "event", id };
    return { ...base, id: JSON.stringify(["event", id]), reference, occurrences: [reference], source: "managed", contexts: ["arrival"],
      emailUids: [], subject: "Fictional utility statement", payee: "Fictional Electric", amountCents: -8200,
      createdAt: base.createdAt - (index + 1) * 86400000, status, reason,
      actions: { complete: false, retry: false, inspect: true, correct: false },
      originalReceipts: status === "completed" ? [{ reference, revision: 1, capturedAt: base.createdAt,
        captureKind: "historical", outcome: "updated", input: { amountCents: -8200 }, result: { scheduleId: "demo-shared-schedule", budgetId: "demo-budget" }, evidence: null }] : [],
      sourceEvidence: [], targetBindings: [], completionPlan: null, importItem: null, runs: [] };
  })].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function handleDemoFinancialActivity(url: URL, method: string): unknown {
  if (method === "POST" && url.pathname === "/api/briefing/financial-activity/binding") return { status: "unavailable", evidence: null };
  if (method !== "GET") return demoNotFound(url.pathname);
  const all = activities();
  if (url.pathname === "/api/briefing/financial-activity") {
    const query = url.searchParams;
    const items = all.filter((item) => (!query.get("view") || query.get("view") === "all" || item.status === query.get("view"))
      && (!query.get("source") || item.source === query.get("source"))
      && (!query.get("context") || item.contexts.includes(query.get("context") as "arrival" | "historical_scan"))
      && (!query.get("runId") || item.runs.some((run) => run.id === query.get("runId"))));
    const offset = Number(query.get("offset") || 0);
    return structuredClone({ items: items.slice(offset, offset + 20), total: items.length, offset, limit: 20 });
  }
  const [owner, id] = url.pathname.split("/").slice(-2).map(decodeURIComponent);
  const item = all.find((entry) => entry.occurrences.some((ref) => ref.owner === owner && ref.id === id
    && (ref.owner !== "import" || ref.runId === url.searchParams.get("runId"))));
  return item ? structuredClone(item) : demoNotFound(url.pathname);
}
