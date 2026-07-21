import { afterEach, describe, expect, it, vi } from "vitest";

describe("Todoist setup API demo contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns inert status and rejects provider actions without network access", async () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    const api = await import("./todoistSetupApi.ts");

    await expect(api.getTodoistConnectionStatus()).resolves.toMatchObject({
      mode: "disconnected",
      application: { source: "absent" },
      deliveryMode: "periodic",
    });
    await expect(api.beginTodoistOAuth()).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.stageTodoistOAuthApplication({ clientId: "id", clientSecret: "secret" }))
      .rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
