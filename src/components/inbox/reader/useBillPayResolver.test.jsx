import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBillPayResolver from "./useBillPayResolver.js";
import { resolveBillPaySeed } from "../../../api.js";

vi.mock("../../../api.js", () => ({
  resolveBillPaySeed: vi.fn(),
}));

afterEach(() => {
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
});
