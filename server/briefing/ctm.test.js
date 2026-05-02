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

  it("fetches calendar deadlines with completed current/future items", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes("status=complete")
        ? [{ id: "done-future", title: "Future complete", due_date: "2026-04-25", status: "complete" }]
        : [{ id: "active-future", title: "Future active", due_date: "2026-04-24", status: "incomplete" }],
    })));

    const { fetchCTMDeadlinesAll } = await import("./ctm.js");
    const out = await fetchCTMDeadlinesAll();

    expect(out.map((event) => event.id)).toEqual(["active-future", "done-future"]);

    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(2);
    expect(urls.some((url) => url.includes("status=incomplete%2Cin_progress"))).toBe(true);
    expect(urls.some((url) => url.includes("status=complete") && url.includes("due_after="))).toBe(true);
  });

  it("fetches range deadlines with active and completed CTM items bounded by due dates", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes("status=complete")
        ? [{ id: "done-range", title: "Done", due_date: "2026-04-28", status: "complete" }]
        : [{ id: "active-range", title: "Active", due_date: "2026-04-29", status: "incomplete" }],
    })));

    const { fetchCTMDeadlinesRange } = await import("./ctm.js");
    const out = await fetchCTMDeadlinesRange({ start: "2026-04-26", end: "2026-06-06" });

    expect(out.map((event) => event.id)).toEqual(["active-range", "done-range"]);
    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes("due_after=2026-04-26"))).toBe(true);
    expect(urls.every((url) => url.includes("due_before=2026-06-06"))).toBe(true);
  });
});
