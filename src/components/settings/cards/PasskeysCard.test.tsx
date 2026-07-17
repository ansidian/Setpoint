import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  listPasskeys: vi.fn(),
  getPasskeyRegistrationOptions: vi.fn(),
  verifyPasskeyRegistration: vi.fn(),
  deletePasskeyCredential: vi.fn(),
}));
const mockSecurityApi = vi.hoisted(() => ({
  stepUpWithPassword: vi.fn(),
  updateOwnerAuthMode: vi.fn(),
  changeOwnerPassword: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
}));
const mockBrowser = vi.hoisted(() => ({
  startPasskeyRegistration: vi.fn(),
}));

vi.mock("@/api", () => mockApi);
vi.mock("@/auth/securityApi", () => mockSecurityApi);
vi.mock("@/auth/passkeyBrowser", () => mockBrowser);

const { default: PasskeysCard } = await import("./PasskeysCard");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.listPasskeys.mockResolvedValue({
    enforcementActive: false,
    authMode: "password_or_passkey",
    recentAuth: true,
    recovery: { remaining: 0, generatedAt: null },
    passkeys: [],
  });
  mockApi.getPasskeyRegistrationOptions.mockResolvedValue({ challenge: "registration-challenge" });
  mockBrowser.startPasskeyRegistration.mockResolvedValue({ id: "credential-1", response: {} });
  mockApi.verifyPasskeyRegistration.mockResolvedValue({
    enforcementActive: false,
    authMode: "password_or_passkey",
    passkey: passkeyRow({ credentialId: "credential-1", label: "MacBook Touch ID" }),
  });
  mockApi.deletePasskeyCredential.mockResolvedValue({
    success: true,
    enforcementActive: false,
    authMode: "password_or_passkey",
    recentAuth: true,
    recovery: { remaining: 0, generatedAt: null },
    passkeys: [],
  });
  mockSecurityApi.stepUpWithPassword.mockResolvedValue({ recentAuth: true });
  mockSecurityApi.updateOwnerAuthMode.mockResolvedValue({ authMode: "password_plus_passkey", recentAuth: true });
  mockSecurityApi.changeOwnerPassword.mockResolvedValue({ success: true, recentAuth: true });
  mockSecurityApi.regenerateRecoveryCodes.mockResolvedValue({
    recoveryCodes: ["SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222"],
  });
});

describe("PasskeysCard", () => {
  it("shows setup mode and storage-separation guidance when no passkeys exist", async () => {
    render(<PasskeysCard />);

    expect(await screen.findByText("Password or passkey")).toBeTruthy();
    expect(screen.getByText(/Password stays available after you register a passkey/i)).toBeTruthy();
    expect(screen.getByText(/Use a device passkey or hardware security key/i)).toBeTruthy();
    expect(screen.getByPlaceholderText("MacBook Touch ID")).toBeTruthy();
  });

  it("registers a passkey through browser WebAuthn and refreshes in place", async () => {
    render(<PasskeysCard />);

    await screen.findByText("Password or passkey");

    fireEvent.change(screen.getByPlaceholderText("MacBook Touch ID"), {
      target: { value: "MacBook Touch ID" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));

    await waitFor(() => {
      expect(mockApi.getPasskeyRegistrationOptions).toHaveBeenCalledWith("MacBook Touch ID");
      expect(mockBrowser.startPasskeyRegistration).toHaveBeenCalledWith({ challenge: "registration-challenge" });
      expect(mockApi.verifyPasskeyRegistration).toHaveBeenCalledWith({
        id: "credential-1",
        response: {},
        label: "MacBook Touch ID",
      });
    });
    expect(screen.getByText("Password or passkey")).toBeTruthy();
    expect(screen.getByText("MacBook Touch ID")).toBeTruthy();
    expect(screen.getByPlaceholderText<HTMLInputElement>("MacBook Touch ID").value).toBe("");
  });

  it("shows registered metadata and backup recommendation", async () => {
    mockApi.listPasskeys.mockResolvedValue({
      enforcementActive: true,
      authMode: "password_plus_passkey",
      recentAuth: true,
      recovery: { remaining: 4, generatedAt: Date.now() },
      passkeys: [passkeyRow({
        credentialId: "credential-1",
        label: "Security Key",
        transports: ["usb", "nfc"],
        backedUp: false,
      })],
    });

    render(<PasskeysCard />);

    expect(await screen.findByText("Security Key")).toBeTruthy();
    expect(screen.getByText("Password + passkey")).toBeTruthy();
    expect(screen.getByText(/Add a second passkey when practical/i)).toBeTruthy();
    expect(screen.getByText("usb, nfc")).toBeTruthy();
    expect(screen.getByText("Not backed up")).toBeTruthy();
  });

  it("deletes a passkey after explicit confirmation", async () => {
    mockApi.listPasskeys.mockResolvedValue({
      enforcementActive: true,
      authMode: "password_plus_passkey",
      recentAuth: true,
      recovery: { remaining: 4, generatedAt: Date.now() },
      passkeys: [passkeyRow({ credentialId: "credential-1", label: "Security Key" })],
    });

    render(<PasskeysCard />);

    expect(await screen.findByText("Security Key")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete Security Key" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => {
      expect(mockApi.deletePasskeyCredential).toHaveBeenCalledWith("credential-1");
    });
    expect(screen.getByText("Password or passkey")).toBeTruthy();
    expect(screen.queryByText("Security Key")).toBeNull();
  });

  it("enables strict mode only through an explicit action", async () => {
    mockApi.listPasskeys.mockResolvedValue({
      enforcementActive: false,
      authMode: "password_or_passkey",
      recentAuth: true,
      recovery: { remaining: 8, generatedAt: Date.now() },
      passkeys: [passkeyRow({ label: "Security Key" })],
    });
    render(<PasskeysCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Require password + passkey" }));

    await waitFor(() => expect(mockSecurityApi.updateOwnerAuthMode).toHaveBeenCalledWith("password_plus_passkey"));
    expect(screen.getByText("Password + passkey")).toBeTruthy();
  });

  it("unlocks sensitive controls with a recent password confirmation", async () => {
    mockApi.listPasskeys.mockResolvedValue({
      enforcementActive: false,
      authMode: "password_or_passkey",
      recentAuth: false,
      recovery: { remaining: 8, generatedAt: Date.now() },
      passkeys: [],
    });
    render(<PasskeysCard />);

    fireEvent.change(await screen.findByLabelText("Current password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock security changes" }));

    await waitFor(() => expect(mockSecurityApi.stepUpWithPassword).toHaveBeenCalledWith("correct-password"));
    expect(screen.getByPlaceholderText("MacBook Touch ID")).toBeTruthy();
  });

  it("shows regenerated recovery codes only until acknowledged", async () => {
    render(<PasskeysCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate recovery codes" }));

    expect(await screen.findByText("SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I saved these codes" }));
    expect(screen.queryByText("SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222")).toBeNull();
  });
});

function passkeyRow(overrides = {}) {
  return {
    credentialId: "credential-1",
    label: "MacBook Touch ID",
    createdAt: Date.UTC(2026, 4, 14),
    lastUsedAt: null,
    transports: ["internal"],
    backedUp: true,
    credentialDeviceType: "multiDevice",
    ...overrides,
  };
}
