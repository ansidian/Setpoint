// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ActualActionStatus from "./ActualActionStatus.jsx";

afterEach(cleanup);

describe("ActualActionStatus", () => {
  it("renders the canonical Actual match as an accessible status", () => {
    render(<ActualActionStatus resolution={{
      status: "resolved",
      actualStatus: {
        status: "already_scheduled",
        evidence: { amount: 142.31, dueDate: "2026-08-12" },
      },
    }} />);

    const status = screen.getByRole("status");
    expect(status.dataset.tone).toBe("success");
    expect(screen.getByText("Already scheduled in Actual")).toBeTruthy();
    expect(screen.getByText(/no further action needed/i)).toBeTruthy();
  });

  it("does not occupy reader space before resolution begins", () => {
    const { container } = render(<ActualActionStatus resolution={{ status: "idle" }} />);
    expect(container.firstChild).toBeNull();
  });
});
