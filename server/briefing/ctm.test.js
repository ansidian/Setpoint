import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("fetchCTMDeadlines", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("CTM_API_URL", "https://ctm.example");
    vi.stubEnv("CTM_API_KEY", "secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetches all active deadlines plus completed current/future deadlines", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes("status=complete")
        ? [{ id: "done-future", title: "Future complete", due_date: "2026-04-25", status: "complete" }]
        : [{ id: "active-overdue", title: "Past active", due_date: "2026-04-20", status: "incomplete" }],
    })));

    const { fetchCTMDeadlines } = await import("./ctm.js");
    const out = await fetchCTMDeadlines();

    expect(out.map((event) => event.id)).toEqual(["active-overdue", "done-future"]);

    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(2);
    expect(urls.some((url) => url.includes("status=incomplete%2Cin_progress"))).toBe(true);
    expect(urls.some((url) => url.includes("status=complete") && url.includes("due_after="))).toBe(true);
    expect(urls.every((url) => !url.includes("due_before="))).toBe(true);
  });
});
