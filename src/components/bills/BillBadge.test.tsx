import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BillBadge from "./BillBadge";
import type { ComponentProps } from "react";
import { getActualMetadata, sendToActualBudget } from "../../api";
import { invalidateActualMetadata } from "../../lib/actualMetadata";

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView = vi.fn();

// test-architecture: allow-boundary-mock -- the rendered bill workflow crosses authenticated browser HTTP for Actual metadata, extraction, and the financial write; controlled responses keep the real form and metadata cache integrated.
vi.mock("../../api", () => ({
  extractBillFromEmail: vi.fn(),
  getActualMetadata: vi.fn(),
  sendToActualBudget: vi.fn(),
}));

beforeEach(() => {
  invalidateActualMetadata();
  vi.mocked(getActualMetadata).mockResolvedValue({
    accounts: [{ id: "checking", name: "Checking", type: "checking" }],
    payees: [{ id: "payee-power", name: "Power Co" }],
    categories: [{ group_name: "Utilities", categories: [{ id: "cat-utilities", name: "Utilities" }] }],
  });
  vi.mocked(sendToActualBudget).mockResolvedValue({ message: "Sent to Actual" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBillBadge(props: Partial<ComponentProps<typeof BillBadge>> = {}) {
  return render(
    <BillBadge
      bill={{ payee: "", amount: null, due_date: "", type: "expense" }}
      emailSubject="Payment due"
      emailFrom="Bank"
      emailBody=""
      {...props}
    />,
  );
}

async function renderSendableBill(overrides: Record<string, unknown> = {}) {
  renderBillBadge({
    bill: {
      payee: "U.S. Bank",
      amount: 100,
      due_date: "2026-05-10",
      type: "expense",
      account_id: "checking",
      ...overrides,
    },
    emailBody: "Full bill body",
  });
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send to Actual Budget" }).disabled).toBe(false));
}

describe("BillBadge", () => {
  it("keeps extraction disabled while the full provider body is loading", () => {
    renderBillBadge({ emailBodyLoading: true });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /extract bill/i }).disabled).toBe(true);
  });

  it("keeps extraction disabled for preview fallback bodies", () => {
    renderBillBadge({ emailBody: "Preview fallback without full bill details.", emailBodySource: "fallback" });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /extract bill/i }).disabled).toBe(true);
  });

  it("renders an editable notes field and the mapping status", async () => {
    renderBillBadge({
      mapping: { status: "matched", profileId: "edison", behaviorId: "monthly", amountSource: "blank" },
    });
    expect(await screen.findByPlaceholderText("Optional note")).toBeTruthy();
    expect(screen.getByText("Mapped: edison · monthly · amount missing")).toBeTruthy();
  });

  it("sends an explicit empty note across the financial write boundary", async () => {
    await renderSendableBill();
    fireEvent.click(screen.getByRole("button", { name: "Send to Actual Budget" }));
    expect(await screen.findByText("Sent to Actual")).toBeTruthy();
    // test-architecture: allow-boundary-interaction -- the success response does not echo memo clearing; the exact outbound financial payload must preserve an intentional empty note.
    expect(sendToActualBudget).toHaveBeenCalledWith(expect.objectContaining({ notes: "" }));
  });

  it("sends user-entered notes across the financial write boundary", async () => {
    await renderSendableBill();
    fireEvent.change(screen.getByPlaceholderText("Optional note"), { target: { value: "Autopay scheduled from checking" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Actual Budget" }));
    expect(await screen.findByText("Sent to Actual")).toBeTruthy();
    // test-architecture: allow-boundary-interaction -- the server response cannot reveal the memo sent to Actual, so the edited note must be verified at the outbound financial boundary.
    expect(sendToActualBudget).toHaveBeenCalledWith(expect.objectContaining({ notes: "Autopay scheduled from checking" }));
  });

  it("prefills the visible notes field with a detected credit-card fee breakdown", async () => {
    renderBillBadge({ bill: { payee: "SCE", amount: 100, due_date: "2026-05-10", type: "expense", account_id: "checking" } });
    expect(await screen.findByDisplayValue("$100.00 + $1.65 CC fee")).toBeTruthy();
  });

  it("clamps a negative custom fee before the financial write", async () => {
    await renderSendableBill();
    fireEvent.click(screen.getByRole("button", { name: "Toggle CC fee" }));
    const inputs = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(inputs[inputs.length - 1]!, { target: { value: "-40" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Actual Budget" }));
    expect(await screen.findByText("Sent to Actual")).toBeTruthy();
    // test-architecture: allow-boundary-interaction -- visible success does not expose the amount committed to Actual; this financial safety contract requires the clamped base-only outbound value.
    expect(sendToActualBudget).toHaveBeenCalledWith(expect.objectContaining({ amount: 100 }));
  });

  it("shows a positive custom fee in the rendered total", async () => {
    await renderSendableBill();
    fireEvent.click(screen.getByRole("button", { name: "Toggle CC fee" }));
    const inputs = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(inputs[inputs.length - 1]!, { target: { value: "2.50" } });
    expect(screen.getByText("$102.50")).toBeTruthy();
  });

  it("applies late resolver fields that the user has not touched", async () => {
    const { rerender } = renderBillBadge();
    await screen.findByPlaceholderText("Optional note");
    rerender(<BillBadge bill={{ payee: "Power Co", payee_id: "payee-power", amount: 73.11, due_date: "2026-05-30", type: "expense", account_id: "checking", category_id: "cat-utilities" }} emailSubject="Payment due" emailFrom="Bank" emailBody="Full bill body" />);
    expect(await screen.findByDisplayValue("73.11")).toBeTruthy();
  });

  it("does not overwrite a user-edited amount when a late seed arrives", async () => {
    const { rerender } = renderBillBadge();
    const amount = await screen.findByPlaceholderText("0.00");
    fireEvent.change(amount, { target: { value: "11.00" } });
    rerender(<BillBadge bill={{ payee: "Power Co", amount: 73.11, due_date: "2026-05-30", type: "expense" }} emailSubject="Payment due" emailFrom="Bank" emailBody="Full bill body" />);
    expect(screen.getByDisplayValue("11.00")).toBeTruthy();
  });
});
