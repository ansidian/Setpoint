import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  generateGmailPubSubCallback: vi.fn(),
  getGmailPubSubStatus: vi.fn(),
  importGmailPubSubEnvironmentToken: vi.fn(),
  revokeGmailPubSubToken: vi.fn(),
  setGmailPubSubTopic: vi.fn(),
  testGmailPubSubWatches: vi.fn(),
  useHostGmailPubSubToken: vi.fn(),
}));

vi.mock("@/lib/gmailPubSubSetupApi", () => api);
const { default: GmailRealtimeCard } = await import("./GmailRealtimeCard");

const periodicStatus = {
  configured: false,
  healthy: true,
  deliveryMode: "periodic",
  deliveryStatus: "periodic_reconciliation",
  delayedUpdates: true,
  topic: { source: "absent", configured: false },
  pushToken: { source: "absent", configured: false },
  callbackUrl: "https://setpoint.example.com/api/gmail/push",
  watchTest: { lastTestedAt: null, lastSucceededAt: null, lastFailedAt: null, errorCode: null },
} as const;

beforeEach(() => {
  api.getGmailPubSubStatus.mockResolvedValue(periodicStatus);
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GmailRealtimeCard", () => {
  it("treats periodic reconciliation as a healthy basic mode", async () => {
    render(<GmailRealtimeCard />);
    expect(await screen.findByText("Periodic updates active")).toBeTruthy();
    expect(screen.getByText(/optional enhancement/i)).toBeTruthy();
  });

  it("reveals a generated callback once and lets the owner close it", async () => {
    api.generateGmailPubSubCallback.mockResolvedValue({
      callbackUrl: "https://setpoint.example.com/api/gmail/push?token=one-time-secret",
      externalSubscriptionUpdateRequired: true,
      status: { ...periodicStatus, configured: true, deliveryMode: "push_and_periodic" },
    });
    render(<GmailRealtimeCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate callback" }));

    expect(await screen.findByRole("dialog", { name: "Gmail callback created" })).toBeTruthy();
    expect(screen.getByText(/one-time-secret/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close callback" }));
    expect(screen.queryByText(/one-time-secret/)).toBeNull();
  });

  it("requires confirmation before regeneration and explains the external consequence", async () => {
    api.getGmailPubSubStatus.mockResolvedValue({
      ...periodicStatus,
      configured: true,
      deliveryMode: "push_and_periodic",
      topic: { source: "stored", configured: true },
      pushToken: { source: "stored", configured: true },
    });
    api.generateGmailPubSubCallback.mockResolvedValue({
      callbackUrl: "https://setpoint.example.com/api/gmail/push?token=replacement",
      externalSubscriptionUpdateRequired: true,
      status: periodicStatus,
    });
    render(<GmailRealtimeCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate callback" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/existing Pub\/Sub subscription/i));
    await waitFor(() => expect(api.generateGmailPubSubCallback).toHaveBeenCalledTimes(1));
  });
});
