import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { InstanceCredentialMetadata } from "../../../../shared/types/instance-credentials";

const mockApi = vi.hoisted(() => ({
  disableInstanceCredential: vi.fn(),
  discardInstanceCredentialPending: vi.fn(),
  getInstanceCredentials: vi.fn(),
  importInstanceCredentialEnvironment: vi.fn(),
  stageInstanceCredential: vi.fn(),
  testInstanceCredential: vi.fn(),
  useHostInstanceCredential: vi.fn(),
}));
const mockSecurity = vi.hoisted(() => ({
  stepUpWithPassword: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- credential staging, provider validation, version-bound discard, import, and disable cross authenticated HTTP/provider boundaries.
vi.mock("@/api", () => mockApi);
// test-architecture: allow-boundary-mock -- protected credential mutations may require the authenticated password-step-up boundary.
vi.mock("@/auth/securityApi", () => mockSecurity);

const { default: CoreProviderCredentialsCard } = await import("./CoreProviderCredentialsCard");

const metadata = (overrides: Partial<InstanceCredentialMetadata> = {}): InstanceCredentialMetadata => ({
  key: "ai.openai_api_key",
  handling: "secret",
  capabilities: ["email_triage"],
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
});

function renderCard(initialMetadata = [metadata()]) {
  function Harness() {
    const [credentialMetadata, setCredentialMetadata] = useState(initialMetadata);
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
      <CoreProviderCredentialsCard
        title="AI provider credentials"
        icon={<span aria-hidden="true" />}
        description="Provider keys"
        credentials={[{
          key: "ai.openai_api_key",
          label: "OpenAI",
          inputLabel: "OpenAI API key",
          placeholder: "Enter a new API key",
          help: "OpenAI help",
        }]}
        credentialMetadata={credentialMetadata}
        onCredentialMetadataChange={updateCredentialMetadata}
        onRefreshCredentialMetadata={refreshCredentialMetadata}
      />
    );
  }
  return render(
    <Harness />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.getInstanceCredentials.mockResolvedValue({ credentials: [metadata()], rootKey: {} });
  mockSecurity.stepUpWithPassword.mockResolvedValue({ recentAuth: true });
});

describe("CoreProviderCredentialsCard", () => {
  it("tests and activates a new write-only value, then empties the field", async () => {
    const pending = metadata({ pendingConfigured: true, validationState: "pending", version: 1 });
    const active = metadata({
      source: "stored",
      activeConfigured: true,
      validationState: "valid",
      lastTestedAt: Date.now(),
      lastSucceededAt: Date.now(),
      version: 2,
    });
    mockApi.stageInstanceCredential.mockResolvedValue(pending);
    mockApi.testInstanceCredential.mockResolvedValue({ ok: true, code: "VALID", metadata: active });

    renderCard([metadata()]);
    const input = await screen.findByLabelText("OpenAI API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-private-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and save" }));

    // test-architecture: allow-boundary-interaction -- provider validation must target the exact registry key, which is normalized away from the success copy.
    await waitFor(() => expect(mockApi.testInstanceCredential).toHaveBeenCalledWith("ai.openai_api_key"));
    // test-architecture: allow-boundary-interaction -- the write-only credential and registry key are outbound staging inputs intentionally absent after activation.
    expect(mockApi.stageInstanceCredential).toHaveBeenCalledWith("ai.openai_api_key", "sk-private-value");
    expect(input.value).toBe("");
    expect(await screen.findByText("Validated and activated. Runtime configuration is updated.")).toBeTruthy();
    expect(screen.getByText("Setpoint")).toBeTruthy();
  });

  it("keeps the active source visible when a pending replacement fails", async () => {
    const active = metadata({ source: "stored", activeConfigured: true, validationState: "valid", version: 4 });
    const pending = metadata({ ...active, pendingConfigured: true, validationState: "pending", version: 5 });
    const failed = metadata({
      ...active,
      pendingConfigured: true,
      validationState: "invalid",
      errorCode: "INVALID_CREDENTIAL",
      version: 6,
    });
    mockApi.getInstanceCredentials.mockResolvedValueOnce({ credentials: [failed], rootKey: {} });
    mockApi.stageInstanceCredential.mockResolvedValue(pending);
    mockApi.testInstanceCredential.mockRejectedValue(Object.assign(new Error("redacted"), { code: "INVALID_CREDENTIAL" }));

    renderCard([active]);
    const input = await screen.findByLabelText("OpenAI API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "bad-private-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Test replacement" }));

    expect(await screen.findByText("Pending replacement failed")).toBeTruthy();
    expect(screen.getByText("Setpoint")).toBeTruthy();
    expect(screen.getByText(/check the value/i)).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("shows pending expiry and discards only the candidate after password step-up", async () => {
    const expiresAt = Date.UTC(2026, 6, 21, 18);
    const pending = metadata({ source: "stored", activeConfigured: true, pendingConfigured: true, pendingStagedAt: expiresAt - 86_400_000, pendingExpiresAt: expiresAt, validationState: "pending", version: 7 });
    const active = metadata({ source: "stored", activeConfigured: true, validationState: "valid", version: 8 });
    mockApi.discardInstanceCredentialPending
      .mockRejectedValueOnce(Object.assign(new Error("Confirm your password"), { code: "PASSWORD_STEP_UP_REQUIRED", status: 403 }))
      .mockResolvedValueOnce(active);
    mockApi.getInstanceCredentials.mockResolvedValueOnce({ credentials: [active], rootKey: {} });

    renderCard([pending]);
    expect(await screen.findByText(/Pending candidate expires/)).toBeTruthy();
    expect(screen.getByText("Setpoint")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard pending" }));
    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and retry" }));

    // test-architecture: allow-boundary-interaction -- discard must compare the exact pending version so a stale retry cannot remove a newer candidate.
    expect(mockApi.discardInstanceCredentialPending).toHaveBeenLastCalledWith("ai.openai_api_key", 7);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard pending" })).toBeNull());
    expect(screen.getByText("Setpoint")).toBeTruthy();
  });

  it("copies an environment value server-side and explains the Render cleanup boundary", async () => {
    const environment = metadata({ source: "environment", activeConfigured: true });
    const stored = metadata({ source: "stored", activeConfigured: true });
    mockApi.importInstanceCredentialEnvironment.mockResolvedValue(stored);

    renderCard([environment]);
    const input = await screen.findByLabelText("OpenAI API key") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Copy into Setpoint" }));

    // test-architecture: allow-boundary-interaction -- environment-to-store migration must target the exact credential key; the resulting source label does not identify the submitted key.
    await waitFor(() => expect(mockApi.importInstanceCredentialEnvironment).toHaveBeenCalledWith("ai.openai_api_key"));
    expect(input.value).toBe("");
    expect(await screen.findByText(/render variable still remains/i)).toBeTruthy();
  });

  it("requires inline confirmation before disabling a stored credential", async () => {
    const stored = metadata({ source: "stored", activeConfigured: true });
    const disabled = metadata({ source: "disabled", activeConfigured: false });
    mockApi.disableInstanceCredential.mockResolvedValue(disabled);

    renderCard([stored]);
    fireEvent.click(await screen.findByRole("button", { name: "Remove and disable" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirm remove OpenAI credential" }));
    // test-architecture: allow-boundary-interaction -- disabling a stored credential is a destructive outbound mutation whose exact registry key disappears from the rendered result.
    await waitFor(() => expect(mockApi.disableInstanceCredential).toHaveBeenCalledWith("ai.openai_api_key"));
  });

  it("keeps an unsaved value in place while password step-up retries the save", async () => {
    const pending = metadata({ pendingConfigured: true, validationState: "pending", version: 1 });
    const active = metadata({ source: "stored", activeConfigured: true, validationState: "valid", version: 2 });
    mockApi.stageInstanceCredential
      .mockRejectedValueOnce(Object.assign(new Error("Confirm your password"), {
        code: "PASSWORD_STEP_UP_REQUIRED",
        status: 403,
      }))
      .mockResolvedValueOnce(pending);
    mockApi.testInstanceCredential.mockResolvedValue({ ok: true, code: "VALID", metadata: active });

    renderCard();
    const input = await screen.findByLabelText("OpenAI API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-private-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and save" }));

    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    expect(input.value).toBe("sk-private-value");
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and retry" }));

    await waitFor(() => expect(input.value).toBe(""));
  });
});
