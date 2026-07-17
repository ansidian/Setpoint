import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Fresh module per test so api.ts's module-level prefetch prime starts clean.
// Mirrors src/demo/demoMode.test.js's importApiWithDemoMode helper.
async function importApi() {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "");
  return import("./api");
}

function jsonOk(payload: unknown): Response {
  return { ok: true, status: 200, json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}

function currentCalls(fetch: Mock<TestFetch>) {
  return fetch.mock.calls.filter(([path]) => path === "/api/dashboard/current");
}

describe("getCurrentDashboard auth-gated prefetch prime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("collapses the prefetch and the mount load into a single /current request", async () => {
    const fetch = vi.fn<TestFetch>(() => Promise.resolve(jsonOk({ fetchedAt: "t1" })));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    api.prefetchCurrentDashboard();
    const loaded = await api.getCurrentDashboard();

    expect(loaded).toEqual({ fetchedAt: "t1" });
    expect(currentCalls(fetch)).toHaveLength(1);
  });

  it("sends loads after the first to the network (the prime is single-use)", async () => {
    const fetch = vi.fn<TestFetch>(() => Promise.resolve(jsonOk({ fetchedAt: "t" })));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    api.prefetchCurrentDashboard();
    await api.getCurrentDashboard(); // consumes the prime
    await api.getCurrentDashboard(); // a later load (poll/reload) must hit the network

    expect(currentCalls(fetch)).toHaveLength(2);
  });

  it("coalesces repeated prefetch calls into one in-flight request", async () => {
    const fetch = vi.fn<TestFetch>(() => Promise.resolve(jsonOk({ fetchedAt: "t" })));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    api.prefetchCurrentDashboard();
    api.prefetchCurrentDashboard();

    expect(currentCalls(fetch)).toHaveLength(1);
  });

  it("fetches fresh when the prime has expired before the load", async () => {
    const fetch = vi.fn<TestFetch>(() => Promise.resolve(jsonOk({ fetchedAt: "t" })));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    vi.useFakeTimers();
    api.prefetchCurrentDashboard();
    vi.advanceTimersByTime(11_000); // past the prime TTL
    await api.getCurrentDashboard();

    expect(currentCalls(fetch)).toHaveLength(2);
  });

  it("drops the prime when the prefetch fails so the load fetches fresh", async () => {
    const fetch = vi.fn<TestFetch>()
      .mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: "boom" }),
      } as unknown as Response))
      .mockImplementation(() => Promise.resolve(jsonOk({ fetchedAt: "ok" })));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    api.prefetchCurrentDashboard();
    // Let the failed prefetch settle so its catch drops the prime before the load.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const data = await api.getCurrentDashboard();

    expect(data).toEqual({ fetchedAt: "ok" });
    expect(currentCalls(fetch)).toHaveLength(2);
  });
});

// A calendar mutation whose request never settles (stalled network) would leave
// the optimistic UI applied forever with no revert path — the ghost-delete
// incident. The four calendar mutation helpers arm an AbortSignal.timeout so the
// fetch rejects, letting the caller's catch revert. See the 2026-07-06 plan.
describe("apiFetch calendar mutation timeouts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function timeoutError() {
    return Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
  }

  it("translates a fetch timeout on deleteCalendarEvent into a settled request_timeout error", async () => {
    const fetch = vi.fn<TestFetch>(() => Promise.reject(timeoutError()));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    await expect(
      api.deleteCalendarEvent("evt-1", { accountId: "a", calendarId: "c" }),
    ).rejects.toMatchObject({ code: "request_timeout" });
  });

  it("arms an abort signal on every calendar mutation helper", async () => {
    const fetch = vi.fn<TestFetch>(() => Promise.resolve(jsonOk({ event: {} })));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    await api.createCalendarEvent({});
    await api.createCalendarEventsBatch([]);
    await api.updateCalendarEvent("id", {});
    await api.deleteCalendarEvent("id", {});

    expect(fetch).toHaveBeenCalledTimes(4);
    for (const [, options] of fetch.mock.calls) {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("leaves a caller-supplied abort on getCalendarRange as AbortError, untranslated", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<TestFetch>((_path, options) => new Promise((_resolve, reject) => {
      const signal = options?.signal;
      if (!signal) throw new Error("Expected abort signal");
      signal.addEventListener("abort", () => reject(signal.reason));
    }));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    const pending = api.getCalendarRange("2026-01-01", "2026-01-31", { signal: controller.signal });
    controller.abort();

    // Search/range cancellation relies on seeing AbortError — the timeout branch
    // must not swallow or rewrite a caller abort into request_timeout.
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(pending).rejects.not.toMatchObject({ code: "request_timeout" });
  });
});

describe("path-interpolated ids", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("encodes reserved characters in a Todoist tombstone id", async () => {
    const fetch = vi.fn<TestFetch>(() => Promise.resolve(jsonOk({})));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    await api.dismissTombstone("abc/def?x=1");

    expect(fetch).toHaveBeenCalledWith(
      "/api/briefing/tombstone/abc%2Fdef%3Fx%3D1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("encodes reserved characters in a note id", async () => {
    const fetch = vi.fn<TestFetch>(() => Promise.resolve(jsonOk({})));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    await api.updateNote("note/one", "updated");

    expect(fetch.mock.calls[0]![0]).toBe("/api/notes/note%2Fone");
  });

  it("encodes reserved characters in a news topic id", async () => {
    const fetch = vi.fn<TestFetch>(() => Promise.resolve(jsonOk({})));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    await api.renameNewsTopic("topic?one", "Renamed");

    expect(fetch.mock.calls[0]![0]).toBe("/api/news/topics/topic%3Fone");
  });
});
