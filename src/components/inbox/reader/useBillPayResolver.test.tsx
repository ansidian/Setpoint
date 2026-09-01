import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBillPayResolver from "./useBillPayResolver";
import { resolveFinancialEmailPlan } from "../../../api";
import type { BillCandidate, FinancialEmailPlan, FinancialReconciliationStatus } from "../../../../shared/types/bills";

// test-architecture: allow-boundary-mock -- src/api.ts is the authenticated client/server boundary for bill-seed extraction; the hook and cache stay real.
vi.mock("../../../api", () => ({
  resolveFinancialEmailPlan: vi.fn(),
}));

afterEach(() => {
  window.dispatchEvent(new CustomEvent("ea-settings-changed"));
  cleanup();
  vi.clearAllMocks();
});

const email = {
  uid: "msg-1",
  account_id: "gmail-work",
  subject: "Power bill",
  fromEmail: "billing@example.test",
  preview: "Statement ready",
  bill_candidate: { payee_hint: "Power", amount: 10 },
};

function plan(candidate: BillCandidate, status: FinancialReconciliationStatus = "not_scheduled"): FinancialEmailPlan {
  return {
    version: 1,
    identity: { version: 1, status: "resolved", key: "financial-email:v1:test" },
    candidate,
    classification: { documentKind: "utility_statement", eventKind: "payment_due", confidence: 0.99, reasons: [] },
    operation: { intended: "create_schedule", kind: "create_schedule", reasons: [] },
    targets: {
      account: { kind: "account", status: "unresolved", provenance: [] },
      payee: { kind: "payee", status: "unresolved", provenance: [] },
      category: { kind: "category", status: "unresolved", provenance: [] },
      fromAccount: { kind: "from_account", status: "not_applicable", provenance: [] },
      toAccount: { kind: "to_account", status: "not_applicable", provenance: [] },
      schedule: { kind: "schedule", status: "unresolved", provenance: [] },
    },
    reconciliation: { status },
    reviewReasons: [],
    automation: { eligible: false, operationClass: "one_time_expense", rollout: "observe_only", gates: [], reasons: ["automation_class_observe_only"] },
  };
}

describe("useBillPayResolver", () => {
  it("resolves a bill candidate on selection before Bill Pay is opened and caches it", async () => {
    vi.mocked(resolveFinancialEmailPlan).mockResolvedValueOnce(plan(
      { payee: "Power", amount: 42 },
      "already_scheduled",
    ));

    const { result, rerender } = renderHook(
      ({ billOpen }) => useBillPayResolver({
        email,
        billOpen,
        bodyState: { loading: false, body: "Statement balance: $42" },
      }),
      { initialProps: { billOpen: false } },
    );

    await waitFor(() => {
      expect(result.current.resolvedBill).toEqual({ payee: "Power", amount: 42 });
    });
    expect(result.current.actualStatus).toEqual({ status: "already_scheduled" });
    // test-architecture: allow-boundary-interaction -- the extraction request fields are the outbound HTTP payload contract; hook state cannot expose omitted or misrouted fields.
    expect(resolveFinancialEmailPlan).toHaveBeenCalledWith({
      emailId: "msg-1",
      accountId: "gmail-work",
      subject: "Power bill",
      from: "billing@example.test",
      snippet: "Statement ready",
      body: "Statement balance: $42",
      candidate: { payee_hint: "Power", amount: 10 },
      source: "triage",
    });

    rerender({ billOpen: true });
    rerender({ billOpen: false });
  });

  it("reuses a resolved seed when returning to the same email", async () => {
    const secondEmail = {
      ...email,
      uid: "msg-2",
      subject: "Water bill",
    };
    vi.mocked(resolveFinancialEmailPlan)
      .mockResolvedValueOnce(plan({ payee: "Power", amount: 42 }, "already_scheduled"))
      .mockResolvedValueOnce(plan({ payee: "Water", amount: 24 }));

    const { result, rerender } = renderHook(
      ({ selectedEmail }) => useBillPayResolver({
        email: selectedEmail,
        billOpen: false,
        bodyState: { loading: false, body: "Statement balance" },
      }),
      { initialProps: { selectedEmail: email } },
    );

    await waitFor(() => {
      expect(result.current.resolvedBill).toEqual({ payee: "Power", amount: 42 });
    });

    rerender({ selectedEmail: secondEmail });
    await waitFor(() => {
      expect(result.current.resolvedBill).toEqual({ payee: "Water", amount: 24 });
    });

    rerender({ selectedEmail: email });
    await waitFor(() => {
      expect(result.current.resolvedBill).toEqual({ payee: "Power", amount: 42 });
    });
  });

  it("invalidates the cached seed on settings changes", async () => {
    vi.mocked(resolveFinancialEmailPlan)
      .mockResolvedValueOnce(plan({ payee: "Old" }))
      .mockResolvedValueOnce(plan({ payee: "New" }));

    const { result } = renderHook(() => useBillPayResolver({
      email,
      billOpen: true,
      bodyState: { loading: false, body: "Statement balance: $42" },
    }));

    await waitFor(() => {
      expect(result.current.resolvedBill).toEqual({ payee: "Old" });
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("ea-settings-changed"));
    });

    await waitFor(() => {
      expect(result.current.resolvedBill).toEqual({ payee: "New" });
    });
  });

  it("invalidates the cached seed when Actual data changes", async () => {
    vi.mocked(resolveFinancialEmailPlan)
      .mockResolvedValueOnce(plan({ payee: "Power" }))
      .mockResolvedValueOnce(plan({ payee: "Power" }, "already_scheduled"));

    const { result } = renderHook(() => useBillPayResolver({
      email,
      billOpen: false,
      bodyState: { loading: false, body: "Statement balance: $42" },
    }));

    await waitFor(() => {
      expect(result.current.actualStatus).toEqual({ status: "not_scheduled" });
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("ea-actual-metadata-invalidated"));
    });

    await waitFor(() => {
      expect(result.current.actualStatus).toEqual({ status: "already_scheduled" });
    });
  });
});
