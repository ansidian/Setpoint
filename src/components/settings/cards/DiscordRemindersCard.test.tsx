import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  testDiscordReminderWebhook: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/api", () => mockApi);

const { default: DiscordRemindersCard } = await import("./DiscordRemindersCard");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DiscordRemindersCard", () => {
  it("reflects a saved configuration from settings", () => {
    render(<DiscordRemindersCard settings={{ discord_webhook_configured: true, discord_user_id: "123" }} />);
    expect(screen.getByText("Saved")).toBeTruthy();
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
  });

  it("clears the saved configuration and drops the Saved pill", async () => {
    mockApi.updateSettings.mockResolvedValue({ success: true });
    render(<DiscordRemindersCard settings={{ discord_webhook_configured: true, discord_user_id: "123" }} />);
    expect(screen.getByText("Saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        discord_webhook_url: "",
        discord_user_id: "",
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("Saved")).toBeNull();
    });
  });

  it("sends a test webhook and surfaces the Test sent status", async () => {
    mockApi.testDiscordReminderWebhook.mockResolvedValue({ success: true });
    render(<DiscordRemindersCard settings={{ discord_webhook_configured: true, discord_user_id: "123" }} />);
    fireEvent.click(screen.getByRole("button", { name: /send test/i }));
    await waitFor(() => {
      expect(mockApi.testDiscordReminderWebhook).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Test sent")).toBeTruthy();
  });
});
