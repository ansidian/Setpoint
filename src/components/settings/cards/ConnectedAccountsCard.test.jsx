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

  it("shows a Reconnect button and revoked-access label for a needs_reauth gmail account", async () => {
    const accounts = [
      { id: "a1", type: "gmail", email: "flagged@gmail.com", needs_reauth: true },
    ];
    render(<ConnectedAccountsCard accounts={accounts} setAccounts={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /reconnect/i })).toBeTruthy();
    expect(screen.getByText(/access revoked/i)).toBeTruthy();
  });

  it("does not show a Reconnect button for an account in good standing", async () => {
    const accounts = [
      { id: "a1", type: "gmail", email: "clean@gmail.com", needs_reauth: false },
    ];
    render(<ConnectedAccountsCard accounts={accounts} setAccounts={vi.fn()} />);
    expect((await screen.findAllByText("clean@gmail.com")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /reconnect/i })).toBeNull();
  });

  it("triggers the same Gmail OAuth start when Reconnect is clicked on a flagged gmail account", async () => {
    mockApi.getGmailAuthUrl.mockResolvedValue({ url: "https://accounts.google.com/o/oauth2/auth?mock=1" });
    const accounts = [
      { id: "a1", type: "gmail", email: "flagged@gmail.com", needs_reauth: true },
    ];
    render(<ConnectedAccountsCard accounts={accounts} setAccounts={vi.fn()} />);
    const reconnectButton = await screen.findByRole("button", { name: /reconnect/i });
    fireEvent.click(reconnectButton);
    await waitFor(() => {
      expect(mockApi.getGmailAuthUrl).toHaveBeenCalledTimes(1);
    });
  });

  it("reveals the iCloud form prefilled with the flagged email when Reconnect is clicked on a flagged icloud account", async () => {
    const accounts = [
      { id: "a1", type: "icloud", email: "flagged@icloud.com", needs_reauth: true },
    ];
    render(<ConnectedAccountsCard accounts={accounts} setAccounts={vi.fn()} />);
    const reconnectButton = await screen.findByRole("button", { name: /reconnect/i });
    fireEvent.click(reconnectButton);
    expect((await screen.findByPlaceholderText("name@icloud.com")).value).toBe("flagged@icloud.com");
  });
});
