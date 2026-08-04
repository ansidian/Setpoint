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

// test-architecture: allow-boundary-mock -- passkey options, verification, and deletion cross the authenticated HTTP boundary while local-lock behavior renders normally.
vi.mock("@/api", () => mockApi);
// test-architecture: allow-boundary-mock -- owner-mode, password, recovery-code, and step-up mutations are authenticated security HTTP boundaries.
vi.mock("@/auth/securityApi", () => mockSecurityApi);
// test-architecture: allow-boundary-mock -- WebAuthn registration is a browser credential ceremony that cannot execute in happy-dom.
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
  it("starts locked even when the server session is still recently authenticated", async () => {
    render(<PasskeysCard />);

    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    expect(screen.queryByPlaceholderText("MacBook Touch ID")).toBeNull();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Password or passkey/i }).disabled).toBe(true);
  });

  it("locks an open security panel when the page is leaving", async () => {
    render(<PasskeysCard />);
    await unlockSecurityChanges();
    expect(await screen.findByPlaceholderText("MacBook Touch ID")).toBeTruthy();

    fireEvent(window, new Event("pagehide"));

    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(screen.queryByPlaceholderText("MacBook Touch ID")).toBeNull();
  });

  it("requires another unlock after the security section unmounts and remounts", async () => {
    const firstVisit = render(<PasskeysCard />);
    await unlockSecurityChanges();
    expect(screen.getByPlaceholderText("MacBook Touch ID")).toBeTruthy();

    firstVisit.unmount();
    render(<PasskeysCard />);

    expect(await screen.findByLabelText("Current password")).toBeTruthy();
    expect(screen.queryByPlaceholderText("MacBook Touch ID")).toBeNull();
  });

  it("shows setup mode and storage-separation guidance when no passkeys exist", async () => {
    render(<PasskeysCard />);

    expect(await screen.findByText("Password or passkey")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Password or passkey/i }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Password \+ passkey/i }).disabled).toBe(true);
    expect(screen.getByText(/Password stays available after you register a passkey/i)).toBeTruthy();
    expect(screen.getByText(/Use a device passkey or hardware security key/i)).toBeTruthy();
    await unlockSecurityChanges();
    expect(screen.getByText(/Add at least one passkey before requiring both factors/i)).toBeTruthy();
    expect(screen.getByPlaceholderText("MacBook Touch ID")).toBeTruthy();
  });

  it("registers a passkey through browser WebAuthn and refreshes in place", async () => {
    render(<PasskeysCard />);

    await screen.findByText("Password or passkey");
    await unlockSecurityChanges();

    fireEvent.change(screen.getByPlaceholderText("MacBook Touch ID"), {
      target: { value: "MacBook Touch ID" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- the passkey label is an outbound registration-options input not repeated in the provider challenge.
      expect(mockApi.getPasskeyRegistrationOptions).toHaveBeenCalledWith("MacBook Touch ID");
      // test-architecture: allow-boundary-interaction -- the server challenge must be passed unchanged into the browser WebAuthn ceremony.
      expect(mockBrowser.startPasskeyRegistration).toHaveBeenCalledWith({ challenge: "registration-challenge" });
      // test-architecture: allow-boundary-interaction -- browser attestation plus the owner label form the verification wire contract and are not recoverable from the normalized passkey row.
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

    await unlockSecurityChanges();
    expect(screen.getByText("Security Key")).toBeTruthy();
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

    await unlockSecurityChanges();
    expect(screen.getByText("Security Key")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete Security Key" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- destructive passkey deletion must target the exact opaque credential identity, which disappears from rendered state after success.
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

    await unlockSecurityChanges();
    fireEvent.click(screen.getByRole("radio", { name: /Password \+ passkey/i }));

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

    expect(await screen.findByPlaceholderText("MacBook Touch ID")).toBeTruthy();
  });

  it("keeps both sign-in mode choices visible before recent password confirmation", async () => {
    mockApi.listPasskeys.mockResolvedValue({
      enforcementActive: false,
      authMode: "password_or_passkey",
      recentAuth: false,
      recovery: { remaining: 8, generatedAt: Date.now() },
      passkeys: [passkeyRow({ label: "Security Key" })],
    });
    render(<PasskeysCard />);

    const relaxedMode = await screen.findByRole<HTMLInputElement>("radio", { name: /Password or passkey/i });
    const strictMode = screen.getByRole<HTMLInputElement>("radio", { name: /Password \+ passkey/i });
    expect(relaxedMode.disabled).toBe(true);
    expect(strictMode.disabled).toBe(true);
    expect(screen.getByText(/Confirm your password below to change this mode/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock security changes" }));

    await waitFor(() => expect(strictMode.disabled).toBe(false));
  });

  it("shows regenerated recovery codes only until acknowledged", async () => {
    render(<PasskeysCard />);
    await unlockSecurityChanges();
    fireEvent.click(screen.getByRole("button", { name: "Generate recovery codes" }));

    expect(await screen.findByText("SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I saved these codes" }));
    expect(screen.queryByText("SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222")).toBeNull();
  });

  it("rejects a short replacement password before calling the security API", async () => {
    render(<PasskeysCard />);
    await unlockSecurityChanges();

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "too-short" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "too-short" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText(/at least 12 characters/i)).toBeTruthy();
    // test-architecture: allow-boundary-interaction -- client validation must prevent any password material from crossing the security HTTP boundary.
    expect(mockSecurityApi.changeOwnerPassword).not.toHaveBeenCalled();
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

async function unlockSecurityChanges() {
  fireEvent.change(await screen.findByLabelText("Current password"), { target: { value: "correct-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock security changes" }));
  await screen.findByPlaceholderText("MacBook Touch ID");
}
