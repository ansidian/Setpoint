import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  addICloudAccount: vi.fn(),
  geocodeLocation: vi.fn(),
  getAccounts: vi.fn(),
  getGmailAuthUrl: vi.fn(),
  removeAccount: vi.fn(),
  testDiscordReminderWebhook: vi.fn(),
  testActualBudget: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/api", () => ({
  addICloudAccount: mockApi.addICloudAccount,
  geocodeLocation: mockApi.geocodeLocation,
  getAccounts: mockApi.getAccounts,
  getGmailAuthUrl: mockApi.getGmailAuthUrl,
  removeAccount: mockApi.removeAccount,
  testDiscordReminderWebhook: mockApi.testDiscordReminderWebhook,
  testActualBudget: mockApi.testActualBudget,
  updateSettings: mockApi.updateSettings,
}));

const { default: AccountsSettingsSection } = await import("./AccountsSettingsSection.jsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.geocodeLocation.mockResolvedValue([
    { name: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
    { name: "Los Angeles County, CA", lat: 34.155, lng: -118.25 },
  ]);
  mockApi.getAccounts.mockResolvedValue([]);
});

describe("AccountsSettingsSection", () => {
  it("patches the selected weather geocode result", async () => {
    const patch = vi.fn();

    render(
      <AccountsSettingsSection
        accounts={[]}
        setAccounts={vi.fn()}
        settings={{}}
        patch={patch}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("El Monte, CA"), {
      target: { value: "Los Angeles" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByText("Los Angeles, CA")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /los angeles, ca/i }));

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith({
        weather_location: "Los Angeles, CA",
        weather_lat: 34.0522,
        weather_lng: -118.2437,
      });
    });
    expect(screen.getByText("34.0522, -118.2437")).toBeTruthy();
  });

  it("saves and tests Discord reminder webhook settings", async () => {
    mockApi.updateSettings.mockResolvedValue({ success: true });
    mockApi.testDiscordReminderWebhook.mockResolvedValue({ success: true });

    render(
      <AccountsSettingsSection
        accounts={[]}
        setAccounts={vi.fn()}
        settings={{
          discord_webhook_configured: true,
          discord_user_id: "123456789",
        }}
        patch={vi.fn()}
      />,
    );

    expect(screen.getByText("Saved")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/discord webhook url/i), {
      target: { value: "https://discord.com/api/webhooks/example" },
    });
    fireEvent.change(screen.getByLabelText(/discord user id/i), {
      target: { value: "987654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save discord$/i }));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        discord_webhook_url: "https://discord.com/api/webhooks/example",
        discord_user_id: "987654321",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /send test/i }));

    await waitFor(() => {
      expect(mockApi.testDiscordReminderWebhook).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Test sent")).toBeTruthy();
  });
});
