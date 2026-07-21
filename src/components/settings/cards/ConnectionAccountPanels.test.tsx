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

vi.mock("@/api", () => mockApi);

const { default: GoogleWorkspaceAccountsPanel } = await import("./GoogleWorkspaceAccountsPanel");
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
  it("gives Google Workspace only the Gmail account controls", async () => {
    render(<GoogleWorkspaceAccountsPanel accounts={accounts} setAccounts={vi.fn()} />);

    expect((await screen.findAllByText("owner@gmail.com")).length).toBeGreaterThan(0);
    expect(screen.queryByText("owner@icloud.com")).toBeNull();
    expect(screen.getByRole("button", { name: "Add Google account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add iCloud/i })).toBeNull();
  });

  it("gives iCloud Mail only the iCloud account controls", async () => {
    render(<ICloudMailAccountsPanel accounts={accounts} setAccounts={vi.fn()} />);

    expect((await screen.findAllByText("owner@icloud.com")).length).toBeGreaterThan(0);
    expect(screen.queryByText("owner@gmail.com")).toBeNull();
    expect(screen.getByRole("button", { name: "Add iCloud account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add Google/i })).toBeNull();
  });

  it("reconnects an iCloud identity through the same write-only app-password form", async () => {
    const flagged = [{ ...accounts[1]!, needs_reauth: true }] as AccountSummary[];
    render(<ICloudMailAccountsPanel accounts={flagged} setAccounts={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    expect(screen.getByLabelText<HTMLInputElement>("iCloud email").value).toBe("owner@icloud.com");

    fireEvent.change(screen.getByLabelText("App-specific password"), { target: { value: "app-password" } });
    mockApi.addICloudAccount.mockResolvedValue({ success: true });
    mockApi.getAccounts.mockResolvedValue({ accounts });
    fireEvent.click(screen.getByRole("button", { name: "Connect iCloud" }));

    await waitFor(() => expect(mockApi.addICloudAccount).toHaveBeenCalledWith("owner@icloud.com", "app-password"));
  });
});
