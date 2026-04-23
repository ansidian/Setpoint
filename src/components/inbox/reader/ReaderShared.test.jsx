import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReaderEmptyState } from "./ReaderShared.jsx";

describe("ReaderEmptyState", () => {
  it("renders the desktop empty state as a bounded square card near the top-left", () => {
    render(<ReaderEmptyState />);

    const card = screen.getByTestId("inbox-reader-empty-state-card");
    expect(card.style.width).toBe("100%");
    expect(card.style.aspectRatio).toBe("1 / 1");
    expect(screen.getByText("Select an email")).toBeTruthy();
  });
});
