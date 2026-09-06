import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import ActualRecordWorkspace from "./ActualRecordWorkspace";
import useBillPayResolver from "./useBillPayResolver";
import { invalidateActualMetadata } from "../../../lib/actualMetadata";
import type { FinancialEmailPlan, FinancialTargetKind } from "../../../../shared/types/bills";

// Consequential contract: unknown or existing ownership cannot expose a second
// Actual writer. Exercise the workspace with its real resolver, cache and form;
// only HTTP is controlled, including failures and a conflicting older import.
const email = { uid: "manual-record", subject: "Payment information", account_id: "work" };
const bodyState = { loading: false as const, body: "Payment details", source: "loaded" as const, error: null };
const target = (kind: FinancialTargetKind) => ({ kind, status: "not_applicable" as const, provenance: [] });
function financialPlan(managed: boolean): FinancialEmailPlan {
  return {
    version: 1, identity: { version: 1, status: "resolved", key: "record" },
    candidate: { type: "expense", amount: 12, payee: "Example", due_date: "2026-09-06", account_id: "checking" },
    classification: { documentKind: "informational", eventKind: "payment_failed", confidence: 0.99, reasons: [] },
    operation: { kind: "no_write", intended: "no_write", reasons: [] },
    targets: { account: target("account"), payee: target("payee"), category: target("category"),
      fromAccount: target("from_account"), toAccount: target("to_account"), schedule: target("schedule") },
    reconciliation: { status: "not_checked", disposition: "none" }, reviewReasons: [],
    automation: { eligible: false, operationClass: "one_time_expense", rollout: "enabled", gates: [], reasons: [] },
    ...(managed ? { workflow: { id: "record", state: "waiting" as const, reason: "Waiting for payment details", relatedEmails: 1, nextAttemptAt: null,
      completion: { emailUid: email.uid, documentRevision: 1, eventRevision: 1, canComplete: true } } } : {}),
  };
}

let failPlan: boolean;
let failImports: boolean;
let managed: boolean;
let importStatus: string | null;
beforeEach(() => {
  failPlan = false;
  failImports = false;
  managed = true;
  importStatus = null;
  invalidateActualMetadata();
  vi.stubGlobal("fetch", async (path: string) => {
    if (path.endsWith("/bills/resolve")) return failPlan ? Response.json({ message: "Unavailable" }, { status: 503 }) : Response.json(financialPlan(managed));
    if (path.includes("/transaction-imports/email-status")) return failImports ? Response.json({ message: "Unavailable" }, { status: 503 })
      : Response.json({ items: importStatus ? [{ status: importStatus, automationMode: "auto" }] : [], financialEvent: null });
    if (path.endsWith("/actual/metadata")) return Response.json({ accounts: [{ id: "checking", name: "Checking" }], payees: [], categories: [] });
    throw new Error("Unexpected financial endpoint: " + path);
  });
});
afterEach(() => { cleanup(); window.dispatchEvent(new CustomEvent("ea-settings-changed")); vi.unstubAllGlobals(); });

function Harness() {
  const billResolution = useBillPayResolver({ email, billOpen: true, bodyState });
  return <MemoryRouter><ActualRecordWorkspace email={email} bodyState={bodyState} billResolution={billResolution} /></MemoryRouter>;
}

describe("Actual record write ownership", () => {
  it("requires a successful ownership lookup and retries into the managed completion form", async () => {
    failPlan = true;
    render(<Harness />);
    expect(await screen.findByText(/Couldn’t load this email’s Actual record/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send to Actual/ })).toBeNull();
    failPlan = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("form", { name: "Complete financial record" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send to Actual Budget" })).toBeNull();
  });

  it("requires the historical import lookup and retains the existing importer after retry", async () => {
    managed = false;
    failImports = true;
    importStatus = "added";
    render(<Harness />);
    expect(await screen.findByText(/Couldn’t load this email’s Actual record/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send to Actual/ })).toBeNull();
    failImports = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Added to Actual")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send to Actual/ })).toBeNull();
  });

  it("offers historical manual entry when neither lookup finds another owner", async () => {
    managed = false;
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send to Actual Budget" }).disabled).toBe(false));
  });
});
