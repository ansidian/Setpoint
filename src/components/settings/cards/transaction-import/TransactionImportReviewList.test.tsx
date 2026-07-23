import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransactionImportReviewList from "./TransactionImportReviewList";
import type { TransactionImportItem } from "../../../../../shared/types/transaction-imports";

function item(overrides: Partial<TransactionImportItem> = {}): TransactionImportItem {
  return {
    id: "item-1",
    runId: "run-1",
    gmailAccountId: "gmail-1",
    gmailMessageId: "message-1",
    emailUid: "gmail-gmail-1-message-1",
    emailSubject: "You paid Demo Merchant $12.00",
    internetMessageId: null,
    source: "paypal",
    parserVersion: "paypal-v1",
    externalId: "external-1",
    importedId: "paypal-external-1",
    date: "2026-07-20",
    amountCents: -1200,
    currency: "USD",
    payee: "Demo Merchant",
    notes: "Receipt",
    actualAccountId: "account-1",
    actualCategoryId: null,
    automationMode: "observe",
    automaticSafe: true,
    blockingWarnings: [],
    evidence: [],
    status: "ready",
    reconciliationStatus: "would_add",
    attempts: 1,
    lastError: null,
    confirmedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function renderList(items = [item()]) {
  const props = {
    items,
    accounts: [{ id: "account-1", name: "Checking" }],
    categoryGroups: [{ group_name: "Shopping", categories: [{ id: "category-1", name: "Online" }] }],
    busyKey: null,
    liveOperationsAvailable: true,
    onCommit: vi.fn().mockResolvedValue({ accepted: 1 }),
    onRetry: vi.fn().mockResolvedValue({ accepted: true }),
    onDismiss: vi.fn().mockResolvedValue({ dismissed: true }),
  };
  return { ...render(<TransactionImportReviewList {...props} />), props };
}

beforeEach(() => vi.stubGlobal("confirm", vi.fn(() => true)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TransactionImportReviewList", () => {
  it("confirms selected count and signed total before a bulk commit", async () => {
    const { props } = renderList();
    fireEvent.click(screen.getByLabelText("Select 1 safe candidate"));
    fireEvent.click(screen.getByRole("button", { name: /Add 1 · -\$12.00/ }));

    await waitFor(() => expect(props.onCommit).toHaveBeenCalledWith([
      expect.objectContaining({ itemId: "item-1", amountCents: -1200 }),
    ]));
    expect(window.confirm).toHaveBeenCalledWith("Add 1 transaction totaling -$12.00 to Actual?");
  });

  it("allows only the correction fields accepted by the backend", async () => {
    const { props } = renderList([item({ automaticSafe: false, status: "needs_review" })]);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.change(screen.getByLabelText("Payee"), { target: { value: "Corrected merchant" } });
    fireEvent.click(screen.getByRole("button", { name: "You paid Demo Merchant $12.00 category" }));
    fireEvent.click(await screen.findByText("Shopping · Online"));
    fireEvent.click(screen.getByRole("button", { name: "Add to Actual" }));

    await waitFor(() => expect(props.onCommit).toHaveBeenCalledWith([
      expect.objectContaining({
        itemId: "item-1",
        payee: "Corrected merchant",
        actualCategoryId: "category-1",
      }),
    ]));
    expect(screen.queryByLabelText("Source")).toBeNull();
    expect(screen.queryByLabelText("Imported ID")).toBeNull();
  });

  it("offers retry for failures and dismiss for reviewable items", () => {
    const review = renderList([item({ automaticSafe: false, status: "needs_review" })]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(review.props.onDismiss).toHaveBeenCalledWith("item-1");
    cleanup();

    const failed = renderList([item({ status: "failed", reconciliationStatus: "failed" })]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(failed.props.onRetry).toHaveBeenCalledWith("item-1");
  });
});
