import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBillBadgeForm from "./useBillBadgeForm.js";
import { sendToActualBudget } from "../../api";

const actualMetadataMock = vi.hoisted(() => ({
  metadata: {
    accounts: [
      { id: "checking", name: "Checking", type: "checking" },
      { id: "visa", name: "Visa 4242", type: "credit" },
    ],
    payees: [{ id: "payee-power", name: "Power Co" }],
    categories: [{ id: "cat-utilities", name: "Utilities" }],
  },
}));

vi.mock("../../api", () => ({
  extractBillFromEmail: vi.fn(),
  sendToActualBudget: vi.fn().mockResolvedValue({ message: "sent" }),
}));

vi.mock("../../lib/actualMetadata.js", () => ({
  _metadataCache: actualMetadataMock.metadata,
  ensureMetadataLoaded: vi.fn((callback) => callback(actualMetadataMock.metadata)),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function renderForm(bill = {}) {
  return renderHook(({ currentBill }) => useBillBadgeForm({
    bill: {
      payee: "U.S. Bank",
      amount: 42.25,
      due_date: "2026-05-10",
      type: "expense",
      ...currentBill,
    },
    emailSubject: "Payment due",
    emailFrom: "Bank",
    emailBody: "Full bill body",
  }), { initialProps: { currentBill: bill } });
}

describe("useBillBadgeForm notes", () => {
  it("sends an explicit empty notes field when notes are blank", () => {
    const { result } = renderForm();

    act(() => {
      result.current.handleSend({ stopPropagation: vi.fn() });
    });

    expect(sendToActualBudget).toHaveBeenCalledWith(expect.objectContaining({
      notes: "",
    }));
  });

  it("sends user-entered notes", () => {
    const { result } = renderForm();

    act(() => {
      result.current.setEditNotes("Autopay scheduled from checking");
    });
    act(() => {
      result.current.handleSend({ stopPropagation: vi.fn() });
    });

    expect(sendToActualBudget).toHaveBeenCalledWith(expect.objectContaining({
      notes: "Autopay scheduled from checking",
    }));
  });

  it("prefills the visible notes field with a CC fee breakdown when notes are blank", async () => {
    const { result } = renderForm({ payee: "SCE", amount: 100 });

    await waitFor(() => {
      expect(result.current.editNotes).toBe("$100.00 + $1.65 CC fee");
    });
  });
});

describe("useBillBadgeForm custom CC fee", () => {
  it("clamps a negative custom fee to 0 so totalAmount never drops below base", () => {
    const { result } = renderForm({ payee: "U.S. Bank", amount: 100 });

    act(() => {
      result.current.setFeeOverride(true);
    });
    act(() => {
      result.current.setCustomFee("-40");
    });

    expect(result.current.parsedFee).toBe(0);
    expect(result.current.totalAmount).toBe(result.current.baseAmount);
    expect(result.current.totalAmount).toBeGreaterThanOrEqual(100);
  });

  it("sends the clamped (base-only) amount when a negative custom fee is entered", () => {
    const { result } = renderForm({ payee: "U.S. Bank", amount: 100 });

    act(() => {
      result.current.setFeeOverride(true);
    });
    act(() => {
      result.current.setCustomFee("-40");
    });
    act(() => {
      result.current.handleSend({ stopPropagation: vi.fn() });
    });

    expect(sendToActualBudget).toHaveBeenCalledWith(expect.objectContaining({
      amount: 100,
    }));
  });

  it("still adds a positive custom fee to the total", () => {
    const { result } = renderForm({ payee: "U.S. Bank", amount: 100 });

    act(() => {
      result.current.setFeeOverride(true);
    });
    act(() => {
      result.current.setCustomFee("2.50");
    });

    expect(result.current.parsedFee).toBe(2.5);
    expect(result.current.totalAmount).toBe(102.5);
  });
});

describe("useBillBadgeForm async seeds", () => {
  it("applies resolver seed fields that the user has not touched", async () => {
    const { result, rerender } = renderForm({
      payee: "",
      amount: null,
      due_date: "",
      type: "expense",
    });

    rerender({
      currentBill: {
        payee: "Power Co",
        payee_id: "payee-power",
        amount: 73.11,
        due_date: "2026-05-30",
        type: "expense",
        account_id: "checking",
        category_id: "cat-utilities",
      },
    });

    await waitFor(() => {
      expect(result.current.editPayee).toBe("payee-power");
      expect(result.current.editAmount).toBe("73.11");
      expect(result.current.editDue).toBe("2026-05-30");
      expect(result.current.editAccount).toBe("checking");
      expect(result.current.editCategory).toBe("cat-utilities");
    });
  });

  it("does not overwrite user-touched fields when a late seed arrives", async () => {
    const { result, rerender } = renderForm({
      payee: "",
      amount: null,
      due_date: "",
      type: "expense",
    });

    act(() => {
      result.current.setEditAmount("11.00");
      result.current.setEditDue("2026-06-02");
    });
    rerender({
      currentBill: {
        payee: "Power Co",
        amount: 73.11,
        due_date: "2026-05-30",
        type: "expense",
      },
    });

    await waitFor(() => {
      expect(result.current.editPayee).toBe("Power Co");
    });
    expect(result.current.editAmount).toBe("11.00");
    expect(result.current.editDue).toBe("2026-06-02");
  });
});
