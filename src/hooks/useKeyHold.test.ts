import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useKeyHold from "./useKeyHold";

describe("useKeyHold", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function keydown(key: string, extra: KeyboardEventInit = {}) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ...extra }));
  }
  function keyup(key: string) {
    window.dispatchEvent(new KeyboardEvent("keyup", { key }));
  }

  it("starts at progress 0 and inactive", () => {
    const { result } = renderHook(() =>
      useKeyHold({ key: "e", durationMs: 750, onComplete: () => {}, enabled: true }),
    );
    expect(result.current.active).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it("fires onComplete after holding key for durationMs", () => {
    const onComplete = vi.fn();
    renderHook(() =>
      useKeyHold({ key: "e", durationMs: 750, onComplete, enabled: true }),
    );
    act(() => { keydown("e"); });
    act(() => { vi.advanceTimersByTime(750); });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not fire if released before durationMs", () => {
    const onComplete = vi.fn();
    renderHook(() =>
      useKeyHold({ key: "e", durationMs: 750, onComplete, enabled: true }),
    );
    act(() => { keydown("e"); });
    act(() => { vi.advanceTimersByTime(400); });
    act(() => { keyup("e"); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("ignores repeated keydown events", () => {
    const onComplete = vi.fn();
    renderHook(() =>
      useKeyHold({ key: "e", durationMs: 750, onComplete, enabled: true }),
    );
    act(() => { keydown("e"); });                         // starts timer
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { keydown("e", { repeat: true }); });       // should NOT restart
    act(() => { vi.advanceTimersByTime(450); });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("ignores key presses when enabled=false", () => {
    const onComplete = vi.fn();
    renderHook(() =>
      useKeyHold({ key: "e", durationMs: 750, onComplete, enabled: false }),
    );
    act(() => { keydown("e"); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("ignores key presses when focus is inside an input", () => {
    const onComplete = vi.fn();
    renderHook(() =>
      useKeyHold({ key: "e", durationMs: 750, onComplete, enabled: true }),
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onComplete).not.toHaveBeenCalled();
    input.remove();
  });

  it("cancels on window blur", () => {
    const onComplete = vi.fn();
    renderHook(() =>
      useKeyHold({ key: "e", durationMs: 750, onComplete, enabled: true }),
    );
    act(() => { keydown("e"); });
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { window.dispatchEvent(new Event("blur")); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
