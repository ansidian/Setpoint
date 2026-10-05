import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import EmailActualStatus from "./EmailActualStatus";
import type { FinancialEmailPlan, FinancialTargetKind } from "../../../../shared/types/bills";

afterEach(cleanup);

const target = (kind: FinancialTargetKind) => ({ kind, status: "not_applicable" as const, provenance: [] });
function managedPlan(state: "needs_review" | "settled"): FinancialEmailPlan {
  return {
    version: 1, identity: { version: 1, status: "resolved", key: "event-one" },
    candidate: { type: "expense", amount: 42, payee: "Gas Utility", currency: "USD" },
    classification: { documentKind: "utility_statement", eventKind: "bill_issued", confidence: 0.99, reasons: [] },
    operation: { intended: "create_transaction", kind: "review", reasons: [] },
    targets: { account: target("account"), payee: target("payee"), category: target("category"),
      fromAccount: target("from_account"), toAccount: target("to_account"), schedule: target("schedule") },
    reconciliation: state === "settled" ? { status: "already_recorded", disposition: "no_write" } : { status: "not_checked", disposition: "review" },
    reviewReasons: [],
    automation: { eligible: false, operationClass: "one_time_expense", rollout: "enabled", gates: [], reasons: [] },
    // Eventless documents carry a synthetic workflow id; the link must not depend on it.
    workflow: { id: "financial-document:7", state, reason: "Confirm the payment details.", relatedEmails: 1, nextAttemptAt: null,
      completion: { emailUid: "gmail:bill/1", documentRevision: 1, eventRevision: null, canComplete: state !== "settled" } },
  };
}

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname + location.search}</output>;
}

function renderStatus(plan: FinancialEmailPlan) {
  render(<MemoryRouter initialEntries={["/inbox"]}>
    <Routes>
      <Route path="/inbox" element={<EmailActualStatus status={{ items: [], financialEvent: plan, recordRequest: null, error: false, loading: false, refresh: async () => {} }} billResolution={null} />} />
      <Route path="/finance" element={<CurrentLocation />} />
    </Routes>
  </MemoryRouter>);
}

describe("EmailActualStatus managed financial record link", () => {
  it.each([
    ["needs_review", "Review in Finance"],
    ["settled", "View record"],
  ] as const)("opens this email's Finance record from a %s status", (state, label) => {
    renderStatus(managedPlan(state));

    fireEvent.click(screen.getByRole("link", { name: label }));

    const search = new URLSearchParams(screen.getByLabelText("Current location").textContent!.split("?")[1]);
    expect(search.get("financialEmail")).toBe("gmail:bill/1");
  });
});
