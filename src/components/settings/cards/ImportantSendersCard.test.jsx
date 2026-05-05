import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getImportantSenders: vi.fn(),
  updateImportantSenders: vi.fn(),
}));

vi.mock("@/api", () => ({
  getImportantSenders: mockApi.getImportantSenders,
  updateImportantSenders: mockApi.updateImportantSenders,
}));

const { default: ImportantSendersCard } = await import("./ImportantSendersCard.jsx");

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
  it("loads existing senders on mount", async () => {
    render(<ImportantSendersCard />);

    expect(await screen.findByText("Boss")).toBeTruthy();
    expect(screen.getByText("boss@company.com")).toBeTruthy();
    expect(screen.getByText("Send browser notifications for these senders. Auto-detected entries are learned from triage urgency.")).toBeTruthy();
    expect(screen.queryByText(/briefing urgency/i)).toBeNull();
  });

  it("adds a new sender and persists the full list", async () => {
    render(<ImportantSendersCard />);

    await screen.findByText("Boss");

    fireEvent.change(screen.getByPlaceholderText("e.g. boss@company.com"), {
      target: { value: "new@company.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mockApi.updateImportantSenders).toHaveBeenCalledWith([
        { address: "boss@company.com", name: "Boss", source: "manual" },
        { address: "new@company.com", name: "new", source: "manual" },
      ]);
    });
    expect(screen.getByText("new@company.com")).toBeTruthy();
  });

  it("removes a sender and persists the remaining list", async () => {
    render(<ImportantSendersCard />);

    await screen.findByText("Boss");

    fireEvent.click(screen.getByTitle("Remove"));

    await waitFor(() => {
      expect(mockApi.updateImportantSenders).toHaveBeenCalledWith([]);
    });
    expect(screen.queryByText("boss@company.com")).toBeNull();
  });

  it("ignores duplicate addresses", async () => {
    render(<ImportantSendersCard />);

    await screen.findByText("Boss");

    fireEvent.change(screen.getByPlaceholderText("e.g. boss@company.com"), {
      target: { value: "boss@company.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(mockApi.updateImportantSenders).not.toHaveBeenCalled();
  });
});
