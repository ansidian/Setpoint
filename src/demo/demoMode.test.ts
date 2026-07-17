import { afterEach, describe, expect, it, vi } from "vitest";

async function importApiWithDemoMode(value: string) {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", value);
  return import("../api");
}

describe("demo mode API network guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps auth local and blocks API fetches before network in demo mode", async () => {
    const fetch = vi.fn();
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("navigator", { sendBeacon });

    const api = await importApiWithDemoMode("1");

    await expect(api.checkAuth()).resolves.toEqual({ authenticated: true, demo: true });
    await expect(api.login("anything")).resolves.toEqual({ authenticated: true, demo: true });
    await expect(api.getCurrentDashboard()).resolves.toMatchObject({ fetchedAt: expect.any(String) });
    await expect(api.settleArrivalGrace()).rejects.toMatchObject({
      code: "DEMO_API_UNHANDLED",
    });

    api.settleArrivalGraceOnExit();

    expect(fetch).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("keeps normal API fetch behavior outside demo mode", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ authenticated: true }),
    });
    vi.stubGlobal("fetch", fetch);

    const api = await importApiWithDemoMode("");

    await expect(api.checkAuth()).resolves.toEqual({ authenticated: true });

    expect(fetch).toHaveBeenCalledWith("/api/auth/check", expect.objectContaining({
      headers: expect.objectContaining({
        "X-Requested-With": "Setpoint",
      }),
    }));
  });

  it("routes passkey auth helpers through explicit auth endpoints", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.stubGlobal("fetch", fetch);

    const api = await importApiWithDemoMode("");

    await api.getPasskeyAuthenticationOptions();
    await api.verifyPasskeyAuthentication({ id: "credential-1" } as Parameters<typeof api.verifyPasskeyAuthentication>[0]);
    await api.cancelPasskeyAuthentication();

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/auth/passkey/authentication/options", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-Requested-With": "Setpoint" }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/auth/passkey/authentication/verify", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ id: "credential-1" }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(3, "/api/auth/passkey/authentication/cancel", expect.objectContaining({
      method: "POST",
    }));
  });

  it("routes passkey management helpers through explicit settings endpoints", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.stubGlobal("fetch", fetch);

    const api = await importApiWithDemoMode("");

    await api.listPasskeys();
    await api.getPasskeyRegistrationOptions("MacBook Touch ID");
    await api.verifyPasskeyRegistration({ id: "credential-1", label: "MacBook Touch ID" } as Parameters<typeof api.verifyPasskeyRegistration>[0]);
    await api.deletePasskeyCredential("credential-1");

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/auth/passkeys", expect.objectContaining({
      headers: expect.objectContaining({ "X-Requested-With": "Setpoint" }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/auth/passkeys/registration/options", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ label: "MacBook Touch ID" }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(3, "/api/auth/passkeys/registration/verify", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ id: "credential-1", label: "MacBook Touch ID" }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(4, "/api/auth/passkeys/credential-1", expect.objectContaining({
      method: "DELETE",
    }));
  });

  it("keeps passkey management unavailable in demo mode before network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const api = await importApiWithDemoMode("1");

    await expect(api.listPasskeys()).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.getPasskeyRegistrationOptions("MacBook Touch ID"))
      .rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not redirect the login page on passkey verification 401 responses", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ message: "Passkey verification failed" }),
    });
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState({}, "", "/login");

    const api = await importApiWithDemoMode("");

    await expect(api.verifyPasskeyAuthentication({ id: "credential-1" } as Parameters<typeof api.verifyPasskeyAuthentication>[0]))
      .rejects.toThrow("Passkey verification failed");
    expect(window.location.pathname).toBe("/login");
  });

  it("does not redirect Settings on passkey registration 401 responses", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ message: "Passkey registration failed" }),
    });
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState({}, "", "/settings");

    const api = await importApiWithDemoMode("");

    await expect(api.verifyPasskeyRegistration({ id: "credential-1" } as Parameters<typeof api.verifyPasskeyRegistration>[0]))
      .rejects.toThrow("Passkey registration failed");
    expect(window.location.pathname).toBe("/settings");
  });
});
