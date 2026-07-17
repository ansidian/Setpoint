import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReaderEmptyState } from "./ReaderShared";

describe("ReaderEmptyState", () => {
  it("renders the desktop empty state prompting the user to select an email", () => {
    render(<ReaderEmptyState />);

    expect(screen.getByText("Select an email")).toBeTruthy();
  });
});
