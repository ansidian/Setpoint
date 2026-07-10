import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TransactionSelectedCard from "./TransactionSelectedCard.jsx";

afterEach(cleanup);

describe("TransactionSelectedCard", () => {
  it("renders a complete read-only inflow detail", () => {
    render(<TransactionSelectedCard transaction={{
      id: "income-1",
      date: "2026-05-10",
      payee: "Employer",
      category: "Income",
      account: "Checking",
      notes: "May payroll",
      amount: 5000,
      direction: "income",
      type: "transaction",
    }} />);

    expect(screen.getByText("Employer")).toBeTruthy();
    expect(screen.getAllByText("Inflow").length).toBeGreaterThan(0);
    expect(screen.getByText("+$5,000.00")).toBeTruthy();
    expect(screen.getByText("Income")).toBeTruthy();
    expect(screen.getByText("Checking")).toBeTruthy();
    expect(screen.getByText("May payroll")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
