import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BillsRail from "./BillsRail.jsx";

afterEach(() => {
  cleanup();
});

const futureBill = {
  id: "bill-1",
  name: "Rent",
  amount: 1800,
  next_date: "2099-04-21",
  payee: "Landlord",
  paid: false,
};

describe("BillsRail", () => {
  it("does not reserve empty bill rows after loaded data renders", () => {
    render(<BillsRail accent="#cba6da" bills={[futureBill]} />);

    expect(screen.getByTestId("bills-rail-list").style.minHeight).toBe("");
    expect(screen.queryByTestId("bills-rail-loading-placeholder")).toBeNull();
  });

  it("keeps the five-row reservation for the loading placeholder", () => {
    render(<BillsRail accent="#cba6da" bills={[]} loadingState="empty_loading" />);

    expect(screen.getByTestId("bills-rail-list").style.minHeight).toBe("255px");
    expect(screen.getByTestId("bills-rail-loading-placeholder")).toBeTruthy();
  });
});
