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

});
