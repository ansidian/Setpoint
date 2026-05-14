import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  listPasskeys: vi.fn(),
  getPasskeyRegistrationOptions: vi.fn(),
  verifyPasskeyRegistration: vi.fn(),
  deletePasskeyCredential: vi.fn(),
}));
const mockBrowser = vi.hoisted(() => ({
  startPasskeyRegistration: vi.fn(),
}));

vi.mock("@/api", () => mockApi);
vi.mock("@/auth/passkeyBrowser.js", () => mockBrowser);

const { default: PasskeysCard } = await import("./PasskeysCard.jsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockApi.listPasskeys.mockResolvedValue({ enforcementActive: false, passkeys: [] });
  mockApi.getPasskeyRegistrationOptions.mockResolvedValue({ challenge: "registration-challenge" });
  mockBrowser.startPasskeyRegistration.mockResolvedValue({ id: "credential-1", response: {} });
  mockApi.verifyPasskeyRegistration.mockResolvedValue({
    enforcementActive: true,
    passkey: passkeyRow({ credentialId: "credential-1", label: "MacBook Touch ID" }),
  });
  mockApi.deletePasskeyCredential.mockResolvedValue({ enforcementActive: false, passkeys: [] });
});

describe("PasskeysCard", () => {
  it("shows setup mode and storage-separation guidance when no passkeys exist", async () => {
    render(<PasskeysCard />);

    expect(await screen.findByText("Setup mode")).toBeTruthy();
    expect(screen.getByText(/Future logins stay password-only until a passkey is registered/i)).toBeTruthy();
    expect(screen.getByText(/Use a device passkey or hardware security key/i)).toBeTruthy();
    expect(screen.getByPlaceholderText("MacBook Touch ID")).toBeTruthy();
  });

  it("registers a passkey through browser WebAuthn and refreshes in place", async () => {
    render(<PasskeysCard />);

    await screen.findByText("Setup mode");

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
    expect(screen.getByText("Enforced")).toBeTruthy();
    expect(screen.getByText("MacBook Touch ID")).toBeTruthy();
    expect(screen.getByPlaceholderText("MacBook Touch ID").value).toBe("");
  });

  it("shows registered metadata and backup recommendation", async () => {
    mockApi.listPasskeys.mockResolvedValue({
      enforcementActive: true,
      passkeys: [passkeyRow({
        credentialId: "credential-1",
        label: "Security Key",
        transports: ["usb", "nfc"],
        backedUp: false,
      })],
    });

    render(<PasskeysCard />);

    expect(await screen.findByText("Security Key")).toBeTruthy();
    expect(screen.getByText("Enforced")).toBeTruthy();
    expect(screen.getByText(/Add a second passkey when practical/i)).toBeTruthy();
    expect(screen.getByText("usb, nfc")).toBeTruthy();
    expect(screen.getByText("Not backed up")).toBeTruthy();
  });

  it("deletes a passkey after explicit confirmation", async () => {
    mockApi.listPasskeys.mockResolvedValue({
      enforcementActive: true,
      passkeys: [passkeyRow({ credentialId: "credential-1", label: "Security Key" })],
    });

    render(<PasskeysCard />);

    expect(await screen.findByText("Security Key")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete Security Key" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => {
      expect(mockApi.deletePasskeyCredential).toHaveBeenCalledWith("credential-1");
    });
    expect(screen.getByText("Setup mode")).toBeTruthy();
    expect(screen.queryByText("Security Key")).toBeNull();
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
