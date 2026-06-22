import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({ searchEmails: vi.fn() }));

import { searchEmails } from "../../api";
import useIndexedSearch from "./useIndexedSearch";

function searchResult(uid, overrides = {}) {
  return {
    uid,
    account_id: "a1",
    account_label: "Work",
    subject: `Subject ${uid}`,
    from_address: "sender@example.com",
    email_date: "2026-01-01T00:00:00.000Z",
    read: false,
    ...overrides,
  };
}

function render(initialProps = { search: "", liveReadOverrides: {} }) {
  return renderHook((props) => useIndexedSearch(props), { initialProps });
}

async function flushDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

describe("useIndexedSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchEmails.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays inactive and issues no request for queries shorter than two characters", async () => {
    const { result } = render({ search: "a", liveReadOverrides: {} });
    expect(result.current.indexedSearchActive).toBe(false);
    await flushDebounce();
    expect(searchEmails).not.toHaveBeenCalled();
    expect(result.current.indexedSearch.emails).toEqual([]);
  });

  it("debounces the request, marks loading, then normalizes results and merges read overrides", async () => {
    searchEmails.mockResolvedValue({ results: [searchResult("m1", { read: false })] });

    const { result } = render({ search: "hello", liveReadOverrides: { m1: true } });
    expect(result.current.indexedSearchActive).toBe(true);
    expect(result.current.indexedSearch.loading).toBe(true);
    expect(searchEmails).not.toHaveBeenCalled();

    await flushDebounce();

    expect(searchEmails).toHaveBeenCalledTimes(1);
    expect(searchEmails).toHaveBeenCalledWith("hello");
    expect(result.current.indexedSearch.loading).toBe(false);
    expect(result.current.indexedSearch.emails).toHaveLength(1);
    // read is merged up from the session-wide live override map.
    expect(result.current.indexedSearch.emails[0].read).toBe(true);
  });

  it("cancels a pending request when the query changes before the debounce fires", async () => {
    searchEmails.mockResolvedValue({ results: [searchResult("m1")] });

    const { result, rerender } = render({ search: "foo", liveReadOverrides: {} });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ search: "foobar", liveReadOverrides: {} });
    await flushDebounce();

    expect(searchEmails).toHaveBeenCalledTimes(1);
    expect(searchEmails).toHaveBeenCalledWith("foobar");
    expect(result.current.indexedSearch.emails).toHaveLength(1);
  });

  it("drops a stale in-flight response when a newer request has superseded it", async () => {
    // Two requests both reach the network (debounce elapses for each); the newer
    // one resolves first, then the stale one resolves and must be ignored. This
    // exercises the requestId guard, not the clearTimeout debounce-cancel path.
    let resolveFirst;
    let resolveSecond;
    searchEmails
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockReturnValueOnce(new Promise((r) => { resolveSecond = r; }));

    const { result, rerender } = render({ search: "foo", liveReadOverrides: {} });
    await flushDebounce();
    expect(searchEmails).toHaveBeenNthCalledWith(1, "foo");

    rerender({ search: "foobar", liveReadOverrides: {} });
    await flushDebounce();
    expect(searchEmails).toHaveBeenNthCalledWith(2, "foobar");

    // Newest (request 2) lands first and wins.
    await act(async () => {
      resolveSecond({ results: [searchResult("from-newest")] });
      await Promise.resolve();
    });
    expect(result.current.indexedSearch.emails.map((e) => e.uid)).toEqual(["from-newest"]);

    // Stale (request 1) lands late and must NOT clobber the newer result.
    await act(async () => {
      resolveFirst({ results: [searchResult("from-stale")] });
      await Promise.resolve();
    });
    expect(result.current.indexedSearch.emails.map((e) => e.uid)).toEqual(["from-newest"]);
  });

  it("surfaces a search error while retaining the active query and clearing loading", async () => {
    searchEmails.mockRejectedValue(new Error("boom"));

    const { result } = render({ search: "hello", liveReadOverrides: {} });
    await flushDebounce();

    expect(result.current.indexedSearch.error).toBe("boom");
    expect(result.current.indexedSearch.query).toBe("hello");
    expect(result.current.indexedSearch.loading).toBe(false);
    expect(result.current.indexedSearch.emails).toEqual([]);
  });

  it("toggles a single row read and bulk-marks a set of rows", async () => {
    searchEmails.mockResolvedValue({
      results: [searchResult("m1"), searchResult("m2"), searchResult("m3")],
    });

    const { result } = render({ search: "hello", liveReadOverrides: {} });
    await flushDebounce();

    act(() => result.current.updateIndexedSearchRead("m1", true));
    expect(result.current.indexedSearch.emails.find((e) => e.uid === "m1").read).toBe(true);

    act(() => result.current.markIndexedSearchReadBulk(["m2", "m3"]));
    expect(result.current.indexedSearch.emails.find((e) => e.uid === "m2").read).toBe(true);
    expect(result.current.indexedSearch.emails.find((e) => e.uid === "m3").read).toBe(true);
  });

  it("carries a local read toggle forward across a fresh search response", async () => {
    searchEmails.mockResolvedValue({ results: [searchResult("m1", { read: false })] });

    const { result, rerender } = render({ search: "foo", liveReadOverrides: {} });
    await flushDebounce();
    expect(result.current.indexedSearch.emails[0].read).toBe(false);

    act(() => result.current.updateIndexedSearchRead("m1", true));
    expect(result.current.indexedSearch.emails[0].read).toBe(true);

    // A new query re-fetches; the server still reports m1 as unread, but the
    // local toggle must win so the just-applied read state does not go stale.
    rerender({ search: "foobar", liveReadOverrides: {} });
    await flushDebounce();

    expect(result.current.indexedSearch.emails[0].read).toBe(true);
  });
});
