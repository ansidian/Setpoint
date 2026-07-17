import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, withTimeout } from "./fetch-with-timeout.ts";

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the fetch response when fetchFn resolves before the deadline", async () => {
    const mockResponse = { ok: true, status: 200, body: "test" };
    const mockFetchFn = vi.fn().mockResolvedValue(mockResponse);

    const result = await fetchWithTimeout("http://example.com", {}, { timeoutMs: 5000, fetchFn: mockFetchFn });

    expect(result).toBe(mockResponse);
    expect(mockFetchFn).toHaveBeenCalledWith("http://example.com", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("rejects and aborts the signal when fetchFn does not settle within timeoutMs", async () => {
    vi.useFakeTimers();

    const mockFetchFn = vi.fn((url, opts) => {
      // Return a promise that never settles until the signal fires
      return new Promise((resolve, reject) => {
        if (opts.signal.aborted) {
          reject(opts.signal.reason);
        } else {
          opts.signal.addEventListener("abort", () => {
            reject(opts.signal.reason);
          });
        }
      });
    });

    const fetchPromise = fetchWithTimeout("http://example.com", {}, { timeoutMs: 1000, fetchFn: mockFetchFn });

    // Add a catch to prevent unhandled rejection warnings from internal promises
    fetchPromise.catch(() => {});

    // Advance time past the timeout
    await vi.advanceTimersByTimeAsync(1001);

    // Consume the rejection
    await expect(fetchPromise).rejects.toThrow(/fetch timeout after 1000ms: http:\/\/example\.com/);
  });

  it("forwards method, headers, and body untouched and injects signal", async () => {
    const mockResponse = { ok: true };
    const mockFetchFn = vi.fn().mockResolvedValue(mockResponse);

    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
    };

    await fetchWithTimeout("http://example.com", options, { timeoutMs: 5000, fetchFn: mockFetchFn });

    expect(mockFetchFn).toHaveBeenCalledWith(
      "http://example.com",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "value" }),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("throws TypeError if options.signal is already set", async () => {
    const mockFetchFn = vi.fn();
    const controller = new AbortController();

    expect(() =>
      fetchWithTimeout("http://example.com", { signal: controller.signal }, { timeoutMs: 5000, fetchFn: mockFetchFn })
    ).toThrow(TypeError);
  });
});

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the promise value when it settles before the timeout", async () => {
    const value = { data: "test" };
    const promise = Promise.resolve(value);

    const result = await withTimeout(promise, 5000, "test operation");

    expect(result).toBe(value);
  });

  it("rejects with the label when the promise does not settle within timeoutMs", async () => {
    vi.useFakeTimers();

    const promise = new Promise(() => {
      // Never settles
    });

    const timeoutPromise = withTimeout(promise, 1000, "test operation");

    // Add a catch to prevent unhandled rejection warnings from internal promises
    timeoutPromise.catch(() => {});

    await vi.advanceTimersByTimeAsync(1001);

    await expect(timeoutPromise).rejects.toThrow(/test operation timed out after 1000ms/);
  });

  it("clears the timeout timer when the promise settles", async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(global, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const value = { data: "test" };
    const promise = Promise.resolve(value);

    const result = await withTimeout(promise, 5000, "test operation");

    expect(result).toBe(value);
    expect(timeoutSpy).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
