import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AlfredSpendingBreakdown from "./AlfredSpendingBreakdown.jsx";

afterEach(cleanup);

describe("AlfredSpendingBreakdown", () => {
  const buckets = [
    { label: "Groceries", amount: 82, count: 2 },
    { label: "Other", amount: 18, count: 5 },
  ];

  it("renders category labels", () => {
    render(
      <AlfredSpendingBreakdown
        buckets={buckets}
        period={{ start: "2026-06-01", end: "2026-06-30" }}
        group_by="category"
        accent="#cba6da"
      />,
    );
    expect(screen.getByText("Groceries")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
  });

  it("renders formatted amounts", () => {
    render(
      <AlfredSpendingBreakdown
        buckets={buckets}
        period={{ start: "2026-06-01", end: "2026-06-30" }}
        group_by="category"
        accent="#cba6da"
      />,
    );
    expect(screen.getByText("$82.00")).toBeTruthy();
    expect(screen.getByText("$18.00")).toBeTruthy();
  });

  it("renders the group label header", () => {
    render(
      <AlfredSpendingBreakdown
        buckets={buckets}
        period={{ start: "2026-06-01", end: "2026-06-30" }}
        group_by="category"
        accent="#cba6da"
      />,
    );
    expect(screen.getByText("BY CATEGORY")).toBeTruthy();
  });

  it("renders the period label", () => {
    render(
      <AlfredSpendingBreakdown
        buckets={buckets}
        period={{ start: "2026-06-01", end: "2026-06-30" }}
        group_by="category"
        accent="#cba6da"
      />,
    );
    expect(screen.getByText("Jun 2026")).toBeTruthy();
  });

  it("renders a multi-month period as a range", () => {
    render(
      <AlfredSpendingBreakdown
        buckets={buckets}
        period={{ start: "2026-01-01", end: "2026-06-30" }}
        group_by="category"
        accent="#cba6da"
      />,
    );
    expect(screen.getByText("Jan 2026 – Jun 2026")).toBeTruthy();
  });

  it("renders nothing for empty buckets", () => {
    const { container } = render(
      <AlfredSpendingBreakdown
        buckets={[]}
        period={{}}
        group_by="category"
        accent="#cba6da"
      />,
    );
    expect(container.textContent).toBe("");
  });
});
