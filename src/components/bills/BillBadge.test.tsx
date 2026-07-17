import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BillBadge from "./BillBadge";
import type { ComponentProps } from "react";
import { extractBillFromEmail } from "../../api";

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView = vi.fn();

const actualMetadataMock = vi.hoisted(() => ({
  metadata: {
    accounts: [{ id: "checking", name: "Checking", type: "checking" }],
    payees: [],
    categories: [],
  },
}));

vi.mock("../../api", () => ({
  extractBillFromEmail: vi.fn(),
  sendToActualBudget: vi.fn(),
}));

vi.mock("../../lib/actualMetadata", () => ({
  _metadataCache: actualMetadataMock.metadata,
  ensureMetadataLoaded: vi.fn((callback) => callback(actualMetadataMock.metadata)),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBillBadge(props: Partial<ComponentProps<typeof BillBadge>> = {}) {
  render(
    <BillBadge
      bill={{
        payee: "",
        amount: null,
        due_date: "",
        type: "expense",
      }}
      emailSubject="Payment due"
      emailFrom="Bank"
      emailBody=""
      {...props}
    />,
  );
}

describe("BillBadge extraction availability", () => {
  it("keeps extraction disabled while the full provider body is loading", () => {
    renderBillBadge({ emailBodyLoading: true });

    const extractButton = screen.getByRole<HTMLButtonElement>("button", { name: /extract bill/i });
    expect(extractButton.disabled).toBe(true);

    fireEvent.click(extractButton);
    expect(extractBillFromEmail).not.toHaveBeenCalled();
  });

  it("keeps extraction disabled for preview fallback bodies", () => {
    renderBillBadge({
      emailBody: "Preview fallback without full bill details.",
      emailBodySource: "fallback",
    });

    const extractButton = screen.getByRole<HTMLButtonElement>("button", { name: /extract bill/i });
    expect(extractButton.disabled).toBe(true);

    fireEvent.click(extractButton);
    expect(extractBillFromEmail).not.toHaveBeenCalled();
  });
});

describe("BillBadge notes", () => {
  it("renders an editable notes field", () => {
    renderBillBadge();

    expect(screen.getByPlaceholderText("Optional note")).toBeTruthy();
  });
});

describe("BillBadge mapping status", () => {
  it("renders the mapping status label produced by the model", () => {
    renderBillBadge({
      mapping: { status: "matched", profileId: "edison", behaviorId: "monthly", amountSource: "blank" },
    });

    expect(screen.getByText("Mapped: edison · monthly · amount missing")).toBeTruthy();
  });
});
