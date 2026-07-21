import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  login: vi.fn(),
  getPasskeyAuthenticationOptions: vi.fn(),
  verifyPasskeyAuthentication: vi.fn(),
  cancelPasskeyAuthentication: vi.fn(),
}));
const securityApiMocks = vi.hoisted(() => ({ recoverOwnerAccess: vi.fn() }));
const browserMocks = vi.hoisted(() => ({
  startPasskeyAuthentication: vi.fn(),
}));

vi.mock("../api", () => apiMocks);
vi.mock("../auth/securityApi", () => securityApiMocks);
vi.mock("../auth/passkeyBrowser", () => browserMocks);

const { default: Login } = await import("./Login");

describe("Login passkey flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("logs in immediately when no passkey is required", async () => {
    const onLogin = vi.fn();
    apiMocks.login.mockResolvedValue({
      authenticated: true,
      passkeyRequired: false,
      passkeySetupRecommended: true,
    });

    render(<Login onLogin={onLogin} />);
    await submitPassword("correct-password");

    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
    expect(browserMocks.startPasskeyAuthentication).not.toHaveBeenCalled();
  });

  it("auto-starts the passkey prompt and waits for verification before calling onLogin", async () => {
    const onLogin = vi.fn();
    const credential = { id: "credential-1", response: {} };
    const prompt = deferred<unknown>();
    apiMocks.login.mockResolvedValue({ authenticated: false, passkeyRequired: true });
    apiMocks.getPasskeyAuthenticationOptions.mockResolvedValue({ challenge: "challenge-1" });
    browserMocks.startPasskeyAuthentication.mockReturnValue(prompt.promise);
    apiMocks.verifyPasskeyAuthentication.mockResolvedValue({ authenticated: true });

    render(<Login onLogin={onLogin} />);
    await submitPassword("correct-password");

    await waitFor(() => {
      expect(apiMocks.getPasskeyAuthenticationOptions).toHaveBeenCalledTimes(1);
      expect(browserMocks.startPasskeyAuthentication).toHaveBeenCalledWith({ challenge: "challenge-1" });
    });
    expect(onLogin).not.toHaveBeenCalled();

    prompt.resolve(credential);

    await waitFor(() => {
      expect(apiMocks.verifyPasskeyAuthentication).toHaveBeenCalledWith(credential);
      expect(onLogin).toHaveBeenCalledTimes(1);
    });
  });

  it("shows retry and back controls after a canceled passkey prompt", async () => {
    const onLogin = vi.fn();
    apiMocks.login.mockResolvedValue({ authenticated: false, passkeyRequired: true });
    apiMocks.getPasskeyAuthenticationOptions.mockResolvedValue({ challenge: "challenge-1" });
    browserMocks.startPasskeyAuthentication.mockRejectedValue(new Error("Passkey prompt was canceled"));

    render(<Login onLogin={onLogin} />);
    await submitPassword("correct-password");

    expect(await screen.findByRole("button", { name: "Retry passkey" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("retries passkey authentication after a failed prompt", async () => {
    const onLogin = vi.fn();
    apiMocks.login.mockResolvedValue({ authenticated: false, passkeyRequired: true });
    apiMocks.getPasskeyAuthenticationOptions
      .mockResolvedValueOnce({ challenge: "challenge-1" })
      .mockResolvedValueOnce({ challenge: "challenge-2" });
    browserMocks.startPasskeyAuthentication
      .mockRejectedValueOnce(new Error("Canceled"))
      .mockResolvedValueOnce({ id: "credential-1", response: {} });
    apiMocks.verifyPasskeyAuthentication.mockResolvedValue({ authenticated: true });

    render(<Login onLogin={onLogin} />);
    await submitPassword("correct-password");

    const retry = await screen.findByRole("button", { name: "Retry passkey" });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(browserMocks.startPasskeyAuthentication).toHaveBeenLastCalledWith({ challenge: "challenge-2" });
      expect(onLogin).toHaveBeenCalledTimes(1);
    });
  });

  it("cancels pending auth and returns to password entry from the passkey step", async () => {
    apiMocks.login.mockResolvedValue({ authenticated: false, passkeyRequired: true });
    apiMocks.getPasskeyAuthenticationOptions.mockResolvedValue({ challenge: "challenge-1" });
    browserMocks.startPasskeyAuthentication.mockRejectedValue(new Error("Canceled"));
    apiMocks.cancelPasskeyAuthentication.mockResolvedValue({ authenticated: false });

    render(<Login onLogin={vi.fn()} />);
    await submitPassword("correct-password");

    const back = await screen.findByRole("button", { name: "Back" });
    fireEvent.click(back);

    await waitFor(() => expect(apiMocks.cancelPasskeyAuthentication).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("offers passwordless passkey sign-in without submitting a password", async () => {
    apiMocks.getPasskeyAuthenticationOptions.mockResolvedValue({ challenge: "challenge-1" });
    browserMocks.startPasskeyAuthentication.mockResolvedValue({ id: "credential-1", response: {} });
    apiMocks.verifyPasskeyAuthentication.mockResolvedValue({ authenticated: true });
    const onLogin = vi.fn();

    render(<Login onLogin={onLogin} />);
    fireEvent.click(screen.getByRole("button", { name: "Use a passkey" }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
    expect(apiMocks.login).not.toHaveBeenCalled();
  });

  it("recovers with a one-time code and acknowledges replacement codes", async () => {
    securityApiMocks.recoverOwnerAccess.mockResolvedValue({
      authenticated: true,
      recoveryCodes: ["SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222"],
    });
    const onLogin = vi.fn();

    render(<Login onLogin={onLogin} />);
    fireEvent.click(screen.getByRole("button", { name: "Recover access" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "SP-OLD-CODE" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "replacement-password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "replacement-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset access" }));

    expect(await screen.findByText("SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222")).toBeTruthy();
    expect(onLogin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "I saved these codes" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it("rejects a short recovery password before calling the recovery API", async () => {
    render(<Login onLogin={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Recover access" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "SP-OLD-CODE" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "too-short" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "too-short" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset access" }));

    expect(await screen.findByText(/at least 12 characters/i)).toBeTruthy();
    expect(securityApiMocks.recoverOwnerAccess).not.toHaveBeenCalled();
  });
});

async function submitPassword(password: string): Promise<void> {
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(apiMocks.login).toHaveBeenCalled());
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
