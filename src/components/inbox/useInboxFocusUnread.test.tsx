import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useInboxFocusUnread from "./useInboxFocusUnread";

beforeEach(() => { vi.stubEnv("VITE_EA_DEMO", "0"); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("inbox focus preference", () => {
  it("starts off and restores the last boolean choice on remount", () => {
    const first = renderHook(useInboxFocusUnread);
    expect(first.result.current.focusUnread).toBe(false);
    act(() => first.result.current.setFocusUnread(true));
    expect(window.localStorage.getItem("inbox:focusUnread")).toBe("true");
    first.unmount();
    const second = renderHook(useInboxFocusUnread);
    expect(second.result.current.focusUnread).toBe(true);
    act(() => second.result.current.setFocusUnread(false));
    second.unmount();
    expect(renderHook(useInboxFocusUnread).result.current.focusUnread).toBe(false);
  });

  it("survives storage access failure using the in-memory choice", () => {
    // Browser storage is an external boundary; a blocked getter also covers
    // browsers that throw before getItem/setItem can even be called.
    vi.stubGlobal("window", { get localStorage(): Storage { throw new Error("Blocked"); } });
    const first = renderHook(useInboxFocusUnread);
    act(() => first.result.current.setFocusUnread(true));
    first.unmount();
    const second = renderHook(useInboxFocusUnread);
    expect(second.result.current.focusUnread).toBe(true);
    act(() => second.result.current.setFocusUnread(false));
  });

  it("ignores stored real preferences and keeps demo changes exclusively in memory", () => {
    window.localStorage.setItem("inbox:focusUnread", "true");
    vi.stubEnv("VITE_EA_DEMO", "1");
    const first = renderHook(useInboxFocusUnread);
    expect(first.result.current.focusUnread).toBe(false);
    act(() => first.result.current.setFocusUnread(true));
    first.unmount();
    const second = renderHook(useInboxFocusUnread);
    expect(second.result.current.focusUnread).toBe(true);
    act(() => second.result.current.setFocusUnread(false));
    expect(window.localStorage.getItem("inbox:focusUnread")).toBe("true");
  });
});
