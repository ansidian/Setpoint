import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BillSelectedCard from "./BillSelectedCard.tsx";

afterEach(cleanup);

function bill(overrides = {}) {
  return {
    id: "b1",
    name: "Electric",
    amount: 120.5,
    next_date: "2026-07-15",
    paid: false,
    type: "bill",
    ...overrides,
  };
}

describe("BillSelectedCard", () => {
  it("renders an unpaid scheduled bill's name, kind label, and scheduled status", () => {
    render(<BillSelectedCard bill={bill()} />);
    expect(screen.getByText("Electric")).toBeTruthy();
    expect(screen.getByText("Scheduled bill")).toBeTruthy();
    expect(screen.getByText("Scheduled")).toBeTruthy();
  });

  it("labels a transfer and surfaces a distinct payee", () => {
    render(<BillSelectedCard bill={bill({ type: "transfer", name: "Savings", payee: "Ally Bank" })} />);
    expect(screen.getByText("Transfer")).toBeTruthy();
    expect(screen.getByText("Ally Bank")).toBeTruthy();
  });

  it("shows a Paid chip and Cleared status once the bill is paid", () => {
    render(<BillSelectedCard bill={bill({ paid: true })} />);
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("Cleared")).toBeTruthy();
  });

  it("renders the action slot it is given", () => {
    render(<BillSelectedCard bill={bill()} actions={<button type="button">Open in calendar</button>} />);
    expect(screen.getByRole("button", { name: "Open in calendar" })).toBeTruthy();
  });
});
