import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionImportItem } from "../../../../shared/types/transaction-imports";

const getTransactionImportEmailStatus = vi.hoisted(() => vi.fn());
// test-architecture: allow-boundary-mock -- src/api.ts is the authenticated transaction-import status boundary; reader projection and routing stay real.
vi.mock("@/api", () => ({ getTransactionImportEmailStatus }));

const { default: TransactionImportStatus } = await import("./TransactionImportStatus");

function item(status: TransactionImportItem["status"], overrides: Partial<TransactionImportItem> = {}): TransactionImportItem {
  return {
    id: "item-1",
    runId: "run-1",
    gmailAccountId: "gmail-1",
    gmailMessageId: "message-1",
    emailUid: "gmail-gmail-1-message-1",
    emailSubject: "PayPal receipt",
    internetMessageId: null,
    source: "paypal",
    parserVersion: "paypal-v1",
    externalId: "external-1",
    importedId: "paypal-external-1",
    date: "2026-07-20",
    amountCents: -1800,
    currency: "USD",
    payee: "Demo merchant",
    notes: "",
    actualAccountId: "account-1",
    actualCategoryId: null,
    automationMode: "automatic",
    automaticSafe: true,
    blockingWarnings: [],
    evidence: [],
    status,
    reconciliationStatus: status === "added" ? "added" : null,
    attempts: 1,
    lastError: null,
    confirmedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TransactionImportStatus", () => {
  it("uses the same compact success language in any reader host", async () => {
    getTransactionImportEmailStatus.mockResolvedValue({
      emailUid: "gmail-gmail-1-message-1",
      items: [item("added")],
    });
    render(<MemoryRouter><TransactionImportStatus emailUid="gmail-gmail-1-message-1" /></MemoryRouter>);

    expect(await screen.findByText("Added to Actual")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Review" })).toBeNull();
  });

  it("exposes one focused Finance review action for exceptions", async () => {
    getTransactionImportEmailStatus.mockResolvedValue({
      emailUid: "gmail-gmail-1-message-1",
      items: [item("needs_review")],
    });
    render(<MemoryRouter><TransactionImportStatus emailUid="gmail-gmail-1-message-1" /></MemoryRouter>);

    expect(await screen.findByText("Needs review")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review" }).getAttribute("href"))
      .toBe("/settings?tab=finance#transaction-import-review");
  });
});
