import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { InstanceCredentialMetadata } from "../../../../shared/types/instance-credentials";

const mockApi = vi.hoisted(() => ({
  disableGoogleOAuthApplication: vi.fn(),
  discardGoogleOAuthPending: vi.fn(),
  getGmailAuthUrl: vi.fn(),
  getInstanceCredentials: vi.fn(),
  importGoogleOAuthEnvironment: vi.fn(),
  stageGoogleOAuthApplication: vi.fn(),
  useHostGoogleOAuthApplication: vi.fn(),
}));
const mockSecurity = vi.hoisted(() => ({
  getCanonicalOriginStatus: vi.fn(),
  stepUpWithPassword: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- atomic Google application staging, import, discard, disable, and OAuth launch cross authenticated HTTP/provider boundaries.
vi.mock("@/api", () => mockApi);
// test-architecture: allow-boundary-mock -- canonical callback projection and protected mutations cross authenticated security HTTP boundaries.
vi.mock("@/auth/securityApi", () => mockSecurity);

const { default: GoogleOAuthCredentialsCard } = await import("./GoogleOAuthCredentialsCard");

function credential(key: string, overrides: Partial<InstanceCredentialMetadata> = {}): InstanceCredentialMetadata {
  return {
    key,
    handling: key.endsWith("client_id") ? "non_secret" : "secret",
    capabilities: ["email", "calendar"],
    source: "absent",
    activeConfigured: false,
    pendingConfigured: false,
    validationState: "untested",
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    errorCode: null,
    version: null,
    pendingStagedAt: null,
    pendingExpiresAt: null,
    ...overrides,
  };
}

const absent = [
  credential("google.oauth_client_id"),
  credential("google.oauth_client_secret"),
];

function renderCard(initialCredentials = absent) {
  function Harness() {
    const [credentialMetadata, setCredentialMetadata] = useState(initialCredentials);
    async function refreshCredentialMetadata() {
      const result = await mockApi.getInstanceCredentials();
      setCredentialMetadata(result.credentials);
    }
    function updateCredentialMetadata(updated: InstanceCredentialMetadata | InstanceCredentialMetadata[]) {
      const updates = Array.isArray(updated) ? updated : [updated];
      setCredentialMetadata((current) => current.map((item) => (
        updates.find(({ key }) => key === item.key) ?? item
      )));
    }
    return (
      <GoogleOAuthCredentialsCard
        credentialMetadata={credentialMetadata}
        onCredentialMetadataChange={updateCredentialMetadata}
        onRefreshCredentialMetadata={refreshCredentialMetadata}
      />
    );
  }
  return render(<Harness />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.getInstanceCredentials.mockResolvedValue({ credentials: absent, rootKey: {} });
  mockSecurity.getCanonicalOriginStatus.mockResolvedValue({
    callbacks: [{ provider: "Google OAuth", nextUrl: "https://setpoint.example/api/ea/accounts/gmail/callback" }],
  });
  mockSecurity.stepUpWithPassword.mockResolvedValue({ recentAuth: true });
});

describe("GoogleOAuthCredentialsCard", () => {
  it("stages the pair as a pending candidate, clears both fields, and shows the derived callback", async () => {
    const pending = absent.map((item, index) => ({
      ...item,
      pendingConfigured: true,
      validationState: "pending" as const,
      version: index + 1,
    }));
    mockApi.stageGoogleOAuthApplication.mockResolvedValue({
      credentials: pending,
      candidateVersions: { clientId: 1, clientSecret: 2 },
    });

    renderCard();
    const clientId = await screen.findByLabelText("Client ID") as HTMLInputElement;
    const clientSecret = screen.getByLabelText("Client secret") as HTMLInputElement;
    fireEvent.change(clientId, { target: { value: "client-id-private" } });
    fireEvent.change(clientSecret, { target: { value: "client-secret-private" } });
    fireEvent.click(screen.getByRole("button", { name: "Save application" }));

    // test-architecture: allow-boundary-interaction -- the atomic write-only Google application pair is absent from the pending metadata returned after staging.
    await waitFor(() => expect(mockApi.stageGoogleOAuthApplication).toHaveBeenCalledWith("client-id-private", "client-secret-private"));
    expect(clientId.value).toBe("");
    expect(clientSecret.value).toBe("");
    expect(await screen.findByText("Pending validation")).toBeTruthy();
    expect(screen.getByText("https://setpoint.example/api/ea/accounts/gmail/callback")).toBeTruthy();
    expect(screen.getByText(/active application remains in use/i)).toBeTruthy();
  });

  it("copies both environment values atomically and explains the Render cleanup boundary", async () => {
    const environment = absent.map((item) => ({ ...item, source: "environment" as const, activeConfigured: true }));
    const stored = environment.map((item) => ({ ...item, source: "stored" as const }));
    mockApi.importGoogleOAuthEnvironment.mockResolvedValue({ credentials: stored });

    renderCard(environment);
    await screen.findByText("Host environment");
    fireEvent.click(screen.getByRole("button", { name: "Copy into Setpoint" }));

    expect(await screen.findByText(/render variables still remain/i)).toBeTruthy();
    expect((screen.getByLabelText("Client ID") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Client secret") as HTMLInputElement).value).toBe("");
  });

  it("requires inline confirmation before atomically disabling the pair", async () => {
    const stored = absent.map((item) => ({ ...item, source: "stored" as const, activeConfigured: true }));
    const disabled = stored.map((item) => ({ ...item, source: "disabled" as const, activeConfigured: false }));
    mockApi.disableGoogleOAuthApplication.mockResolvedValue({ credentials: disabled });

    renderCard(stored);
    fireEvent.click(await screen.findByRole("button", { name: "Remove and disable" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirm remove Google credentials" }));
    expect(await screen.findByText("Disabled")).toBeTruthy();
  });

  it("keeps the candidate in place while password step-up retries the save", async () => {
    const pending = absent.map((item, index) => ({
      ...item,
      pendingConfigured: true,
      validationState: "pending" as const,
      version: index + 1,
    }));
    mockApi.stageGoogleOAuthApplication
      .mockRejectedValueOnce(Object.assign(new Error("Confirm your password"), {
        code: "PASSWORD_STEP_UP_REQUIRED",
        status: 403,
      }))
      .mockResolvedValueOnce({
        credentials: pending,
        candidateVersions: { clientId: 1, clientSecret: 2 },
      });

    renderCard();
    const clientId = await screen.findByLabelText("Client ID") as HTMLInputElement;
    const clientSecret = screen.getByLabelText("Client secret") as HTMLInputElement;
    fireEvent.change(clientId, { target: { value: "client-id-private" } });
    fireEvent.change(clientSecret, { target: { value: "client-secret-private" } });
    fireEvent.click(screen.getByRole("button", { name: "Save application" }));

    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    expect(clientId.value).toBe("client-id-private");
    expect(clientSecret.value).toBe("client-secret-private");
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and retry" }));

    await waitFor(() => expect(clientId.value).toBe(""));
    expect(clientSecret.value).toBe("");
  });

  it("shows pair expiry and atomically discards the pending pair after step-up", async () => {
    const expiresAt = Date.UTC(2026, 6, 21, 18);
    const active = absent.map((item) => ({ ...item, source: "stored" as const, activeConfigured: true, validationState: "valid" as const, version: item.key.endsWith("client_id") ? 10 : 11 }));
    const pending = active.map((item) => ({ ...item, pendingConfigured: true, validationState: "pending" as const, pendingStagedAt: expiresAt - 86_400_000, pendingExpiresAt: expiresAt }));
    mockApi.discardGoogleOAuthPending
      .mockRejectedValueOnce(Object.assign(new Error("Confirm your password"), { code: "PASSWORD_STEP_UP_REQUIRED", status: 403 }))
      .mockResolvedValueOnce({ credentials: active });
    mockApi.getInstanceCredentials.mockResolvedValueOnce({ credentials: active, rootKey: {} });

    renderCard(pending);
    expect(await screen.findByText(/Pending candidate expires/)).toBeTruthy();
    expect(screen.getByText("Setpoint")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard pending" }));
    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and retry" }));

    // test-architecture: allow-boundary-interaction -- pair discard must compare both exact candidate versions so a stale retry cannot remove newer credentials.
    expect(mockApi.discardGoogleOAuthPending).toHaveBeenLastCalledWith({ clientId: 10, clientSecret: 11 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard pending" })).toBeNull());
    expect(screen.getByText("Setpoint")).toBeTruthy();
  });
});
