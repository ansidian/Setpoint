import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  addICloudAccount: vi.fn(),
  getAccounts: vi.fn(),
  getGmailAuthUrl: vi.fn(),
  removeAccount: vi.fn(),
}));

vi.mock("@/api", () => mockApi);

const { default: ConnectedAccountsCard } = await import("./ConnectedAccountsCard.jsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConnectedAccountsCard", () => {
  it("shows the empty state when no accounts are connected", () => {
    render(<ConnectedAccountsCard accounts={[]} setAccounts={vi.fn()} />);
    expect(screen.getByText("No accounts connected yet.")).toBeTruthy();
  });

  it("surfaces a Gmail auth error instead of an unhandled rejection", async () => {
    mockApi.getGmailAuthUrl.mockRejectedValue(new Error("no API handler for gmail auth"));
    render(<ConnectedAccountsCard accounts={[]} setAccounts={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Gmail" }));
    expect(await screen.findByText(/no API handler for/i)).toBeTruthy();
  });

  it("reveals the iCloud form when Add iCloud is toggled", () => {
    render(<ConnectedAccountsCard accounts={[]} setAccounts={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add iCloud" }));
    expect(screen.getByPlaceholderText("name@icloud.com")).toBeTruthy();
  });

  it("adds an iCloud account and refreshes the list", async () => {
    mockApi.addICloudAccount.mockResolvedValue({ success: true });
    mockApi.getAccounts.mockResolvedValue({ accounts: [{ id: "a1" }] });
    const setAccounts = vi.fn();
    render(<ConnectedAccountsCard accounts={[]} setAccounts={setAccounts} />);
    fireEvent.click(screen.getByRole("button", { name: "Add iCloud" }));
    fireEvent.change(screen.getByPlaceholderText("name@icloud.com"), { target: { value: "me@icloud.com" } });
    fireEvent.change(screen.getByPlaceholderText("App-specific password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect iCloud" }));
    await waitFor(() => {
      expect(mockApi.addICloudAccount).toHaveBeenCalledWith("me@icloud.com", "pw");
      expect(setAccounts).toHaveBeenCalledWith([{ id: "a1" }]);
    });
  });
});
