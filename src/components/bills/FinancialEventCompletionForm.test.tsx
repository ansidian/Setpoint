import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BillBadge from "./BillBadge";
import { invalidateActualMetadata } from "../../lib/actualMetadata";
import type { FinancialEmailPlan, FinancialTargetKind } from "../../../shared/types/bills";
import type { FinancialEventCompletionRequest } from "../../../shared/types/financial-operations";

const target = (kind: FinancialTargetKind) => ({ kind, status: "not_applicable" as const, provenance: [] });
function waitingPlan(revision = 1): FinancialEmailPlan {
  return {
    version: 1, identity: { version: 1, status: "resolved", key: "event-one" },
    candidate: { type: "expense", amount: 30, payee: "Example Merchant", currency: "USD" },
    classification: { documentKind: "one_time_transaction", eventKind: "purchase", confidence: 0.99, reasons: [] },
    operation: { intended: "create_transaction", kind: "review", reasons: [] },
    targets: { account: target("account"), payee: target("payee"), category: { ...target("category"), status: "resolved", id: "inferred-category", label: "Inferred category" },
      fromAccount: target("from_account"), toAccount: target("to_account"), schedule: target("schedule") },
    reconciliation: { status: "not_checked", disposition: "review" }, reviewReasons: [],
    automation: { eligible: false, operationClass: "one_time_expense", rollout: "enabled", gates: [], reasons: [] },
    workflow: { id: "event-one", state: "waiting", reason: "Waiting for the transaction date and account.", relatedEmails: 1, nextAttemptAt: null,
      completion: { emailUid: "receipt-one", documentRevision: revision, eventRevision: revision, canComplete: true } },
  };
}

let currentRevision: number;
let confirmed: FinancialEventCompletionRequest | null;
beforeEach(() => {
  currentRevision = 1;
  confirmed = null;
  invalidateActualMetadata();
  vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
    if (path === "/api/briefing/actual/metadata") return Response.json({
      accounts: [{ id: "checking", name: "Everyday Checking" }], payees: [],
      categories: [{ group_name: "Spending", categories: [{ id: "inferred-category", name: "Inferred category" }] }],
    });
    if (path !== "/api/briefing/financial-events/complete") throw new Error("Unexpected financial write path: " + path);
    const request = JSON.parse(String(options?.body)) as FinancialEventCompletionRequest;
    if (request.documentRevision !== currentRevision || request.eventRevision !== currentRevision || confirmed) {
      return Response.json({ message: "The financial record changed." }, { status: 409 });
    }
    confirmed = request;
    const plan = waitingPlan(++currentRevision);
    return Response.json({ ...plan, workflow: { ...plan.workflow, state: "pending", reason: "Your confirmed record is queued for Actual.",
      completion: { ...plan.workflow!.completion, canComplete: false } } }, { status: 202 });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function fillMissingFields() {
  await waitFor(() => expect(screen.getByRole("option", { name: "Everyday Checking" })).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Transaction date"), { target: { value: "2026-09-06" } });
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: "checking" } });
}

describe("owner completion of a managed financial record", () => {
  it("confirms missing context without an inferred category and distinguishes queuing from a recorded entry", async () => {
    render(<BillBadge bill={{}} plan={waitingPlan()} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send to Actual" }).disabled).toBe(true);
    await fillMissingFields();
    expect(screen.getByLabelText<HTMLSelectElement>("Category (optional)").value).toBe("");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send to Actual" }).disabled).toBe(false);
    fireEvent.submit(screen.getByRole("form", { name: "Complete financial record" }));
    expect(await screen.findByText("Your confirmed record is queued for Actual.")).toBeTruthy();
    expect(screen.queryByText("Recorded in Actual")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send to Actual" })).toBeNull();
    expect(confirmed).toEqual({ emailUid: "receipt-one", documentRevision: 1, eventRevision: 1,
      entry: { kind: "expense", amount: 30, date: "2026-09-06", payee: "Example Merchant", accountId: "checking", categoryId: null, notes: "" } });
  });

  it("preserves owner edits and the reviewed revision when a newer source arrives during editing", async () => {
    const view = render(<BillBadge bill={{}} plan={waitingPlan()} />);
    await fillMissingFields();
    fireEvent.change(screen.getByLabelText("Amount (USD)"), { target: { value: "45" } });
    currentRevision = 2;
    view.rerender(<BillBadge bill={{}} plan={waitingPlan(2)} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send to Actual" }).disabled).toBe(false);
    fireEvent.submit(screen.getByRole("form", { name: "Complete financial record" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Amount (USD)").value).toBe("45");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send to Actual" }).disabled).toBe(true);
    expect(confirmed).toBeNull();
  });
});
