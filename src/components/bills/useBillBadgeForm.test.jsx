import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBillBadgeForm from "./useBillBadgeForm.js";
import { sendToActualBudget } from "../../api";

const actualMetadataMock = vi.hoisted(() => ({
  metadata: {
    accounts: [{ id: "checking", name: "Checking", type: "checking" }],
    payees: [],
    categories: [],
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
  return renderHook(() => useBillBadgeForm({
    bill: {
      payee: "U.S. Bank",
      amount: 42.25,
      due_date: "2026-05-10",
      type: "expense",
      ...bill,
    },
    emailSubject: "Payment due",
    emailFrom: "Bank",
    emailBody: "Full bill body",
  }));
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
