import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
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

function renderList(initialItems = [item()]) {
  function Harness() {
    const [items, setItems] = useState(initialItems);
    return (
      <TransactionImportReviewList
        items={items}
        accounts={[{ id: "account-1", name: "Checking" }]}
        categoryGroups={[{ group_name: "Shopping", categories: [{ id: "category-1", name: "Online" }] }]}
        busyKey={null}
        liveOperationsAvailable
        onCommit={async () => ({ accepted: 1 })}
        onRetry={async (itemId) => {
          setItems((current) => current.map((entry) => entry.id === itemId
            ? { ...entry, status: "queued", lastError: null }
            : entry));
          return { accepted: true };
        }}
        onDismiss={async (itemId) => {
          setItems((current) => current.filter((entry) => entry.id !== itemId));
          return { dismissed: true };
        }}
      />
    );
  }
  return render(<Harness />);
}

beforeEach(() => vi.stubGlobal("confirm", vi.fn(() => true)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TransactionImportReviewList", () => {
  it("confirms selected count and signed total before a bulk commit", async () => {
    renderList();
    fireEvent.click(screen.getByLabelText("Select 1 safe candidate"));
    fireEvent.click(screen.getByRole("button", { name: /Add 1 · -\$12.00/ }));

    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Select 1 safe candidate").checked).toBe(false));
    // test-architecture: allow-boundary-interaction -- the browser confirmation must name the signed financial-write total before crossing the irreversible Actual commit boundary.
    expect(window.confirm).toHaveBeenCalledWith("Add 1 transaction totaling -$12.00 to Actual?");
  });

  it("allows only the correction fields accepted by the backend", async () => {
    renderList([item({ automaticSafe: false, status: "needs_review" })]);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.change(screen.getByLabelText("Payee"), { target: { value: "Corrected merchant" } });
    fireEvent.click(screen.getByRole("button", { name: "You paid Demo Merchant $12.00 category" }));
    fireEvent.click(await screen.findByText("Shopping · Online"));
    fireEvent.click(screen.getByRole("button", { name: "Add to Actual" }));

    await waitFor(() => expect(screen.queryByLabelText("Payee")).toBeNull());
    expect(screen.queryByLabelText("Source")).toBeNull();
    expect(screen.queryByLabelText("Imported ID")).toBeNull();
  });

  it("offers retry for failures and dismiss for reviewable items", () => {
    renderList([item({ automaticSafe: false, status: "needs_review" })]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("You paid Demo Merchant $12.00")).toBeNull();
    cleanup();

    renderList([item({ status: "failed", reconciliationStatus: "failed" })]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("Working")).toBeTruthy();
  });
});
