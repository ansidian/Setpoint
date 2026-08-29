import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getImportantSenders: vi.fn(),
  updateImportantSenders: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- important-sender reads and full-list persistence cross the authenticated settings HTTP boundary while optimistic/rollback state renders normally.
vi.mock("@/api", () => ({
  getImportantSenders: mockApi.getImportantSenders,
  updateImportantSenders: mockApi.updateImportantSenders,
}));

const { default: ImportantSendersCard } = await import("./ImportantSendersCard");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.getImportantSenders.mockResolvedValue([
    { address: "boss@company.com", name: "Boss", source: "manual" },
  ]);
  mockApi.updateImportantSenders.mockResolvedValue({});
});

describe("ImportantSendersCard", () => {
  it("rolls back the optimistic add and surfaces an error when the save fails", async () => {
    mockApi.updateImportantSenders.mockRejectedValueOnce(new Error("Network down"));
    render(<ImportantSendersCard />);

    await screen.findByText("Boss");

    fireEvent.change(screen.getByPlaceholderText("e.g. boss@company.com"), {
      target: { value: "new@company.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // The optimistic row must be rolled back once the persist rejects...
    await waitFor(() => {
      expect(screen.queryByText("new@company.com")).toBeNull();
    });
    // ...and the failure surfaced rather than silently swallowed.
    expect(screen.getByText("Network down")).toBeTruthy();
    expect(screen.getByText("Boss")).toBeTruthy(); // original list intact
  });
});
