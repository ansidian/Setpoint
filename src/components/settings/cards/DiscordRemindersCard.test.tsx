import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  testDiscordReminderWebhook: vi.fn(),
  updateSettings: vi.fn(),
}));
const mockSecurity = vi.hoisted(() => ({
  stepUpWithPassword: vi.fn(),
}));

vi.mock("@/api", () => mockApi);
vi.mock("@/auth/securityApi", () => mockSecurity);

const { default: DiscordRemindersCard } = await import("./DiscordRemindersCard");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockSecurity.stepUpWithPassword.mockResolvedValue({ recentAuth: true });
});

describe("DiscordRemindersCard", () => {
  it("reflects a saved configuration from settings", () => {
    render(<DiscordRemindersCard settings={{ discord_webhook_configured: true, discord_user_id: "123" }} />);
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText(/saving does not send a message or prove delivery/i)).toBeTruthy();
  });

  it("saves the webhook + user id and emits the settings-changed event", async () => {
    mockApi.updateSettings.mockResolvedValue({ success: true });
    render(<DiscordRemindersCard settings={{}} />);
    fireEvent.change(screen.getByLabelText(/discord webhook url/i), {
      target: { value: "https://discord.com/api/webhooks/x" },
    });
    fireEvent.change(screen.getByLabelText(/discord user id/i), { target: { value: "987" } });
    fireEvent.click(screen.getByRole("button", { name: /^save discord$/i }));
    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        discord_webhook_url: "https://discord.com/api/webhooks/x",
        discord_user_id: "987",
      });
    });
    expect(screen.queryByText("Test sent")).toBeNull();
  });

  it("preserves the webhook and user ID while password step-up retries the save", async () => {
    mockApi.updateSettings
      .mockRejectedValueOnce(Object.assign(new Error("Confirm your password"), {
        code: "PASSWORD_STEP_UP_REQUIRED",
        status: 403,
      }))
      .mockResolvedValueOnce({ success: true });
    render(<DiscordRemindersCard settings={{}} />);
    const webhook = screen.getByLabelText(/discord webhook url/i) as HTMLInputElement;
    const userId = screen.getByLabelText(/discord user id/i) as HTMLInputElement;
    fireEvent.change(webhook, { target: { value: "https://discord.com/api/webhooks/x" } });
    fireEvent.change(userId, { target: { value: "987" } });
    fireEvent.click(screen.getByRole("button", { name: /^save discord$/i }));

    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    expect(webhook.value).toBe("https://discord.com/api/webhooks/x");
    expect(userId.value).toBe("987");
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and retry" }));

    await waitFor(() => expect(mockApi.updateSettings).toHaveBeenCalledTimes(2));
    expect(mockApi.updateSettings).toHaveBeenLastCalledWith({
      discord_webhook_url: "https://discord.com/api/webhooks/x",
      discord_user_id: "987",
    });
    expect(mockSecurity.stepUpWithPassword).toHaveBeenCalledWith("owner-password");
    await waitFor(() => expect(webhook.value).toBe(""));
  });

  it("clears the saved configuration and drops the Saved pill", async () => {
    mockApi.updateSettings.mockResolvedValue({ success: true });
    const onRefreshConnections = vi.fn(async () => {});
    render(<DiscordRemindersCard settings={{ discord_webhook_configured: true, discord_user_id: "123" }} onRefreshConnections={onRefreshConnections} />);
    expect(screen.getByText("Saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Discord webhook" }));
    expect(screen.getByText(/discord reminder delivery will stop/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove Discord webhook" }));
    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        discord_webhook_url: "",
        discord_user_id: "",
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("Saved")).toBeNull();
    });
    expect(onRefreshConnections).toHaveBeenCalledTimes(1);
  });

  it("sends a test webhook and surfaces the Test sent status", async () => {
    mockApi.testDiscordReminderWebhook.mockResolvedValue({ success: true });
    render(<DiscordRemindersCard settings={{ discord_webhook_configured: true, discord_user_id: "123" }} />);
    fireEvent.click(screen.getByRole("button", { name: /send test reminder/i }));
    await waitFor(() => {
      expect(mockApi.testDiscordReminderWebhook).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Test sent")).toBeTruthy();
  });
});
