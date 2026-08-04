import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

const browserBoundary = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: browserBoundary.startAuthentication,
  startRegistration: vi.fn(),
}));

const { default: Login } = await import("./Login");

function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function renderLogin(): void {
  function Harness() {
    const [authenticated, setAuthenticated] = useState(false);
    return authenticated
      ? <h1>Dashboard ready</h1>
      : <Login onLogin={() => setAuthenticated(true)} />;
  }
  render(<Harness />);
}

function installAuthServer(overrides: Partial<Record<string, unknown>> = {}): void {
  const defaults: Record<string, unknown> = {
    "/api/auth/login": { authenticated: true, passkeyRequired: false },
    "/api/auth/passkey/authentication/options": { challenge: "challenge-1" },
    "/api/auth/passkey/authentication/verify": { authenticated: true },
    "/api/auth/passkey/authentication/cancel": { authenticated: false },
    "/api/auth/recovery": {
      authenticated: true,
      recoveryCodes: ["SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222"],
    },
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (!(path in defaults) && !(path in overrides)) throw new Error(`Unexpected request: ${path}`);
    return response(path in overrides ? overrides[path] : defaults[path]);
  }));
}

describe("Login passkey flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installAuthServer();
    browserBoundary.startAuthentication.mockResolvedValue({ id: "credential-1", response: {} });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("logs in immediately when no passkey is required", async () => {
    renderLogin();
    await submitPassword("correct-password");

    expect(await screen.findByRole("heading", { name: "Dashboard ready" })).toBeTruthy();
  });

  it("auto-starts the browser passkey prompt and waits for verification", async () => {
    const prompt = deferred<unknown>();
    installAuthServer({ "/api/auth/login": { authenticated: false, passkeyRequired: true } });
    browserBoundary.startAuthentication.mockReturnValue(prompt.promise);

    renderLogin();
    await submitPassword("correct-password");

    expect(await screen.findByRole("button", { name: "Waiting..." })).toBeTruthy();
    // test-architecture: allow-boundary-interaction -- visible waiting state cannot prove the server challenge was handed unchanged to the external WebAuthn browser library.
    expect(browserBoundary.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "challenge-1" },
    });
    expect(screen.queryByRole("heading", { name: "Dashboard ready" })).toBeNull();

    prompt.resolve({ id: "credential-1", response: {} });
    expect(await screen.findByRole("heading", { name: "Dashboard ready" })).toBeTruthy();
  });

  it("shows retry and back controls after a canceled passkey prompt", async () => {
    installAuthServer({ "/api/auth/login": { authenticated: false, passkeyRequired: true } });
    browserBoundary.startAuthentication.mockRejectedValue(new Error("Passkey prompt was canceled"));

    renderLogin();
    await submitPassword("correct-password");

    expect(await screen.findByRole("button", { name: "Retry passkey" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Dashboard ready" })).toBeNull();
  });

  it("retries passkey authentication after a failed prompt", async () => {
    installAuthServer({ "/api/auth/login": { authenticated: false, passkeyRequired: true } });
    browserBoundary.startAuthentication
      .mockRejectedValueOnce(new Error("Canceled"))
      .mockResolvedValueOnce({ id: "credential-1", response: {} });

    renderLogin();
    await submitPassword("correct-password");
    fireEvent.click(await screen.findByRole("button", { name: "Retry passkey" }));

    expect(await screen.findByRole("heading", { name: "Dashboard ready" })).toBeTruthy();
  });

  it("returns to password entry from the passkey step", async () => {
    installAuthServer({ "/api/auth/login": { authenticated: false, passkeyRequired: true } });
    browserBoundary.startAuthentication.mockRejectedValue(new Error("Canceled"));

    renderLogin();
    await submitPassword("correct-password");
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));

    expect(await screen.findByLabelText("Password")).toBeTruthy();
  });

  it("offers passwordless passkey sign-in without submitting a password", async () => {
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "Use a passkey" }));

    expect(await screen.findByRole("heading", { name: "Dashboard ready" })).toBeTruthy();
  });

  it("recovers with a one-time code and requires replacement-code acknowledgement", async () => {
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "Recover access" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "SP-OLD-CODE" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "replacement-password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "replacement-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset access" }));

    expect(await screen.findByText("SP-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Dashboard ready" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I saved these codes" }));
    expect(await screen.findByRole("heading", { name: "Dashboard ready" })).toBeTruthy();
  });

  it("rejects a short recovery password in the browser", async () => {
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "Recover access" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "SP-OLD-CODE" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "too-short" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "too-short" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset access" }));

    expect(await screen.findByText(/at least 12 characters/i)).toBeTruthy();
  });
});

async function submitPassword(password: string): Promise<void> {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(screen.queryByText("Signing in...")).toBeNull());
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
