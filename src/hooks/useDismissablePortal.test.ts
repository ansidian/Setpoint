import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import useDismissablePortal from "./useDismissablePortal";

function makeContainer() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("useDismissablePortal", () => {
  it("dismisses on an outside pointerdown but not one inside the container", () => {
    const container = makeContainer();
    const onDismiss = vi.fn();
    renderHook(() => useDismissablePortal({ ref: { current: container }, active: true, onDismiss }));

    container.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on Escape and stops the event so inner handlers don't double-fire", () => {
    const container = makeContainer();
    const onDismiss = vi.fn();
    renderHook(() => useDismissablePortal({ ref: { current: container }, active: true, onDismiss }));

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(escape);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(escape.defaultPrevented).toBe(true);
  });

  it("delegates Tab to onTabKey without dismissing", () => {
    const container = makeContainer();
    const onDismiss = vi.fn();
    const onTabKey = vi.fn();
    renderHook(() => useDismissablePortal({ ref: { current: container }, active: true, onDismiss, onTabKey }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    expect(onTabKey).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("runs onActivate after open and again whenever activateKey changes", async () => {
    const container = makeContainer();
    const onActivate = vi.fn();
    const { rerender } = renderHook(
      ({ key }) => useDismissablePortal({ ref: { current: container }, active: true, onActivate, activateKey: key }),
      { initialProps: { key: 1 } },
    );

    await Promise.resolve();
    expect(onActivate).toHaveBeenCalledTimes(1);

    rerender({ key: 2 });
    await Promise.resolve();
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("removes its listeners once inactive", () => {
    const container = makeContainer();
    const onDismiss = vi.fn();
    const { rerender } = renderHook(
      ({ active }) => useDismissablePortal({ ref: { current: container }, active, onDismiss }),
      { initialProps: { active: true } },
    );

    rerender({ active: false });
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("treats a pointerdown inside any of multiple refs as inside", () => {
    const panel = makeContainer();
    const anchor = makeContainer();
    const onDismiss = vi.fn();
    renderHook(() =>
      useDismissablePortal({ refs: [{ current: panel }, { current: anchor }], active: true, onDismiss }),
    );

    panel.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    anchor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("spares a pointerdown whose target matches ignoreSelector", () => {
    const panel = makeContainer();
    const ignored = document.createElement("div");
    ignored.setAttribute("data-keep-open", "true");
    document.body.appendChild(ignored);
    const onDismiss = vi.fn();
    renderHook(() =>
      useDismissablePortal({
        refs: [{ current: panel }],
        ignoreSelector: "[data-keep-open='true']",
        active: true,
        onDismiss,
      }),
    );

    ignored.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
