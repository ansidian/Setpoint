import { afterEach, describe, expect, it, vi } from "vitest";

describe("onboarding demo API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("reads and mutates in memory without calling private endpoints", async () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { getOnboardingProgress, updateOnboardingProgress } = await import("./lib/onboardingApi");

    expect((await getOnboardingProgress()).status).toBe("complete");
    expect((await updateOnboardingProgress({ action: "reopen" })).status).toBe("in_progress");
    expect((await updateOnboardingProgress({ action: "skip", stepId: "ai" })).steps.ai).toBe("skipped");
    // test-architecture: allow-boundary-interaction -- in-memory progress results cannot prove demo onboarding avoided every private endpoint at the browser network boundary.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
