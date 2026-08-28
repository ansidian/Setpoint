import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountSummary } from "../../../../shared/types/accounts";

const mockApi = vi.hoisted(() => ({
  addICloudAccount: vi.fn(),
  getAccounts: vi.fn(),
  getGmailAuthUrl: vi.fn(),
  removeAccount: vi.fn(),
  reorderAccounts: vi.fn(),
  updateAccount: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- account connection, OAuth URL, and provider-backed account mutations cross the authenticated HTTP boundary.
vi.mock("@/api", () => mockApi);

const { default: ICloudMailAccountsPanel } = await import("./ICloudMailAccountsPanel");

const accounts = [
  { id: "g1", type: "gmail", email: "owner@gmail.com", needs_reauth: false },
  { id: "i1", type: "icloud", email: "owner@icloud.com", needs_reauth: false },
] as AccountSummary[];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("connection account panels", () => {


  it("reconnects an iCloud identity through the same write-only app-password form", async () => {
    const flagged = [{ ...accounts[1]!, needs_reauth: true }] as AccountSummary[];
    render(<ICloudMailAccountsPanel accounts={flagged} setAccounts={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    expect(screen.getByLabelText<HTMLInputElement>("iCloud email").value).toBe("owner@icloud.com");

    fireEvent.change(screen.getByLabelText("App-specific password"), { target: { value: "app-password" } });
    mockApi.addICloudAccount.mockResolvedValue({ success: true });
    mockApi.getAccounts.mockResolvedValue({ accounts });
    fireEvent.click(screen.getByRole("button", { name: "Connect iCloud" }));

    // test-architecture: allow-boundary-interaction -- the write-only app password and canonical email are outbound provider-connection inputs unavailable after the form clears.
    await waitFor(() => expect(mockApi.addICloudAccount).toHaveBeenCalledWith("owner@icloud.com", "app-password"));
  });
});
