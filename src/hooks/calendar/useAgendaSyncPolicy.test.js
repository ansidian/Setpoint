import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useAgendaSyncPolicy from "./useAgendaSyncPolicy.js";

const owningDetail = { open: true, mode: "detail", itemId: "x", dateKey: "2026-04-20", anchorKind: "chip" };

describe("useAgendaSyncPolicy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not ignore passive sync when idle", () => {
    const { result } = renderHook(() => useAgendaSyncPolicy());
    expect(result.current.shouldIgnorePassiveAgendaSync(null)).toBe(false);
  });

  it("ignores passive sync inside the suppression window and resumes after it lapses", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const { result } = renderHook(() => useAgendaSyncPolicy());

    act(() => result.current.suppressAgendaPassiveSync()); // suppress until 1000 + 900 = 1900

    now.mockReturnValue(1500);
    expect(result.current.shouldIgnorePassiveAgendaSync(null)).toBe(true);

    now.mockReturnValue(2000);
    expect(result.current.shouldIgnorePassiveAgendaSync(null)).toBe(false);
  });

  it("extends, never shortens, the suppression window", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const { result } = renderHook(() => useAgendaSyncPolicy());

    act(() => result.current.suppressAgendaPassiveSync(900)); // until 1900
    now.mockReturnValue(1100);
    act(() => result.current.suppressAgendaPassiveSync(100)); // 1100 + 100 = 1200 < 1900, must not shorten

    now.mockReturnValue(1500);
    expect(result.current.shouldIgnorePassiveAgendaSync(null)).toBe(true);
  });

  it("ignores passive sync while a grid-anchored detail owns the selection", () => {
    const { result } = renderHook(() => useAgendaSyncPolicy());
    expect(result.current.shouldIgnorePassiveAgendaSync(owningDetail)).toBe(true);
    // A non-owning (closed) detail does not block passive sync.
    expect(result.current.shouldIgnorePassiveAgendaSync({ open: false })).toBe(false);
  });
});
