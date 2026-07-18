import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceCredentialMetadata } from "../../../../shared/types/instance-credentials";

const mockApi = vi.hoisted(() => ({
  disableInstanceCredential: vi.fn(),
  getInstanceCredentials: vi.fn(),
  importInstanceCredentialEnvironment: vi.fn(),
  stageInstanceCredential: vi.fn(),
  testInstanceCredential: vi.fn(),
  useHostInstanceCredential: vi.fn(),
}));

vi.mock("@/api", () => mockApi);

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
  ...overrides,
});

function renderCard() {
  return render(
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
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.getInstanceCredentials.mockResolvedValue({ credentials: [metadata()], rootKey: {} });
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

    renderCard();
    const input = await screen.findByLabelText("OpenAI API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-private-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and save" }));

    await waitFor(() => expect(mockApi.testInstanceCredential).toHaveBeenCalledWith("ai.openai_api_key"));
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
    mockApi.getInstanceCredentials
      .mockResolvedValueOnce({ credentials: [active], rootKey: {} })
      .mockResolvedValueOnce({ credentials: [failed], rootKey: {} });
    mockApi.stageInstanceCredential.mockResolvedValue(pending);
    mockApi.testInstanceCredential.mockRejectedValue(Object.assign(new Error("redacted"), { code: "INVALID_CREDENTIAL" }));

    renderCard();
    const input = await screen.findByLabelText("OpenAI API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "bad-private-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Test replacement" }));

    expect(await screen.findByText("Pending replacement failed")).toBeTruthy();
    expect(screen.getByText("Setpoint")).toBeTruthy();
    expect(screen.getByText(/check the value/i)).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("moves an environment value server-side without reading it into the field", async () => {
    const environment = metadata({ source: "environment", activeConfigured: true });
    const stored = metadata({ source: "stored", activeConfigured: true });
    mockApi.getInstanceCredentials.mockResolvedValue({ credentials: [environment], rootKey: {} });
    mockApi.importInstanceCredentialEnvironment.mockResolvedValue(stored);

    renderCard();
    const input = await screen.findByLabelText("OpenAI API key") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Move into Setpoint" }));

    await waitFor(() => expect(mockApi.importInstanceCredentialEnvironment).toHaveBeenCalledWith("ai.openai_api_key"));
    expect(input.value).toBe("");
    expect(await screen.findByText("Moved into encrypted Setpoint storage.")).toBeTruthy();
  });
});
