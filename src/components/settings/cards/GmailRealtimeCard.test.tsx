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
const security = vi.hoisted(() => ({
  stepUpWithPassword: vi.fn(),
}));

vi.mock("@/lib/gmailPubSubSetupApi", () => api);
vi.mock("@/auth/securityApi", () => security);
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
  security.stepUpWithPassword.mockResolvedValue({ recentAuth: true });
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

  it("opens only its advanced disclosure when targeted by a deep link", async () => {
    render(<GmailRealtimeCard openAdvancedSetup />);

    const disclosure = (await screen.findByText("Advanced Pub/Sub setup")).closest("details") as HTMLDetailsElement;
    expect(disclosure.open).toBe(true);
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

  it("preserves the topic while password step-up retries the save", async () => {
    api.setGmailPubSubTopic
      .mockRejectedValueOnce(Object.assign(new Error("Confirm your password"), {
        code: "PASSWORD_STEP_UP_REQUIRED",
        status: 403,
      }))
      .mockResolvedValueOnce(periodicStatus.topic);
    render(<GmailRealtimeCard openAdvancedSetup />);
    const input = await screen.findByLabelText("Google Cloud topic") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "projects/private/topics/gmail" } });
    fireEvent.click(screen.getByRole("button", { name: "Save topic" }));

    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    expect(input.value).toBe("projects/private/topics/gmail");
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and retry" }));

    await waitFor(() => expect(api.setGmailPubSubTopic).toHaveBeenCalledTimes(2));
    expect(security.stepUpWithPassword).toHaveBeenCalledWith("owner-password");
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("describes host-token migration as a copy with an explicit Render cleanup boundary", async () => {
    const environmentStatus = {
      ...periodicStatus,
      pushToken: { source: "environment", configured: true },
    } as const;
    const storedStatus = {
      ...environmentStatus,
      pushToken: { source: "stored", configured: true },
    } as const;
    api.getGmailPubSubStatus.mockResolvedValue(environmentStatus);
    api.importGmailPubSubEnvironmentToken.mockResolvedValue(storedStatus);
    render(<GmailRealtimeCard openAdvancedSetup />);

    fireEvent.click(await screen.findByRole("button", { name: "Copy into Setpoint" }));

    await waitFor(() => expect(api.importGmailPubSubEnvironmentToken).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/render variable still remains/i)).toBeTruthy();
  });
});
