import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBillPayResolver from "./useBillPayResolver.js";
import { resolveBillPaySeed } from "../../../api";

vi.mock("../../../api", () => ({
  resolveBillPaySeed: vi.fn(),
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

describe("useBillPayResolver", () => {
  it("resolves a bill candidate on selection before Bill Pay is opened", async () => {
    resolveBillPaySeed.mockResolvedValueOnce({
      bill: { payee: "Power", amount: 42 },
      mapping: { status: "matched" },
      actualStatus: { status: "already_scheduled" },
    });

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
    expect(resolveBillPaySeed).toHaveBeenCalledTimes(1);
    expect(resolveBillPaySeed).toHaveBeenCalledWith({
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
    expect(resolveBillPaySeed).toHaveBeenCalledTimes(1);
  });

  it("reuses a resolved seed when returning to the same email", async () => {
    const secondEmail = {
      ...email,
      uid: "msg-2",
      subject: "Water bill",
    };
    resolveBillPaySeed
      .mockResolvedValueOnce({
        bill: { payee: "Power", amount: 42 },
        mapping: { status: "matched" },
        actualStatus: { status: "already_scheduled" },
      })
      .mockResolvedValueOnce({
        bill: { payee: "Water", amount: 24 },
        mapping: { status: "matched" },
        actualStatus: { status: "not_scheduled" },
      });

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
    expect(resolveBillPaySeed).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cached seed on settings changes", async () => {
    resolveBillPaySeed
      .mockResolvedValueOnce({ bill: { payee: "Old" }, mapping: { status: "matched" } })
      .mockResolvedValueOnce({ bill: { payee: "New" }, mapping: { status: "matched" } });

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
    expect(resolveBillPaySeed).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cached seed when Actual data changes", async () => {
    resolveBillPaySeed
      .mockResolvedValueOnce({
        bill: { payee: "Power" },
        mapping: { status: "matched" },
        actualStatus: { status: "not_scheduled" },
      })
      .mockResolvedValueOnce({
        bill: { payee: "Power" },
        mapping: { status: "matched" },
        actualStatus: { status: "already_scheduled" },
      });

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
    expect(resolveBillPaySeed).toHaveBeenCalledTimes(2);
  });
});
