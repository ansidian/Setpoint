import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { InstanceCredentialMetadata } from "../../../../shared/types/instance-credentials";

const mockApi = vi.hoisted(() => ({
  disableInstanceCredential: vi.fn(),
  getGmailAuthUrl: vi.fn(),
  getInstanceCredentials: vi.fn(),
  importInstanceCredentialEnvironment: vi.fn(),
  stageGoogleOAuthApplication: vi.fn(),
  useHostInstanceCredential: vi.fn(),
}));
const mockSecurity = vi.hoisted(() => ({ getCanonicalOriginStatus: vi.fn() }));

vi.mock("@/api", () => mockApi);
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
});

describe("GoogleOAuthCredentialsCard", () => {
  it("uses coordinator metadata without issuing an initial page-load read", async () => {
    renderCard();

    expect(await screen.findByLabelText("Client ID")).toBeTruthy();
    expect(mockApi.getInstanceCredentials).not.toHaveBeenCalled();
  });

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

    await waitFor(() => expect(mockApi.stageGoogleOAuthApplication).toHaveBeenCalledWith("client-id-private", "client-secret-private"));
    expect(clientId.value).toBe("");
    expect(clientSecret.value).toBe("");
    expect(await screen.findByText("Pending validation")).toBeTruthy();
    expect(screen.getByText("https://setpoint.example/api/ea/accounts/gmail/callback")).toBeTruthy();
    expect(screen.getByText(/active application remains in use/i)).toBeTruthy();
  });

  it("migrates both environment values without placing either value in browser state", async () => {
    const environment = absent.map((item) => ({ ...item, source: "environment" as const, activeConfigured: true }));
    const stored = environment.map((item) => ({ ...item, source: "stored" as const }));
    mockApi.getInstanceCredentials.mockResolvedValueOnce({ credentials: stored, rootKey: {} });
    mockApi.importInstanceCredentialEnvironment.mockResolvedValue(stored[0]);

    renderCard(environment);
    await screen.findByText("Host environment");
    fireEvent.click(screen.getByRole("button", { name: "Move into Setpoint" }));

    await waitFor(() => expect(mockApi.importInstanceCredentialEnvironment).toHaveBeenCalledTimes(2));
    expect(mockApi.importInstanceCredentialEnvironment).toHaveBeenCalledWith("google.oauth_client_id");
    expect(mockApi.importInstanceCredentialEnvironment).toHaveBeenCalledWith("google.oauth_client_secret");
    expect((screen.getByLabelText("Client ID") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Client secret") as HTMLInputElement).value).toBe("");
  });
});
