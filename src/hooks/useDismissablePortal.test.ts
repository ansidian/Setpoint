import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
    let dismissCount = 0;
    renderHook(() => useDismissablePortal({ ref: { current: container }, active: true, onDismiss: () => { dismissCount += 1; } }));

    container.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(dismissCount).toBe(0);

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(dismissCount).toBe(1);
  });

  it("dismisses on Escape and stops the event so inner handlers don't double-fire", () => {
    const container = makeContainer();
    let dismissCount = 0;
    renderHook(() => useDismissablePortal({ ref: { current: container }, active: true, onDismiss: () => { dismissCount += 1; } }));

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(escape);

    expect(dismissCount).toBe(1);
    expect(escape.defaultPrevented).toBe(true);
  });

  it("delegates Tab to onTabKey without dismissing", () => {
    const container = makeContainer();
    let dismissCount = 0;
    let tabCount = 0;
    renderHook(() => useDismissablePortal({
      ref: { current: container },
      active: true,
      onDismiss: () => { dismissCount += 1; },
      onTabKey: () => { tabCount += 1; },
    }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    expect(tabCount).toBe(1);
    expect(dismissCount).toBe(0);
  });

  it("runs onActivate after open and again whenever activateKey changes", async () => {
    const container = makeContainer();
    let activateCount = 0;
    const { rerender } = renderHook(
      ({ key }) => useDismissablePortal({ ref: { current: container }, active: true, onActivate: () => { activateCount += 1; }, activateKey: key }),
      { initialProps: { key: 1 } },
    );

    await Promise.resolve();
    expect(activateCount).toBe(1);

    rerender({ key: 2 });
    await Promise.resolve();
    expect(activateCount).toBe(2);
  });

  it("removes its listeners once inactive", () => {
    const container = makeContainer();
    let dismissCount = 0;
    const { rerender } = renderHook(
      ({ active }) => useDismissablePortal({ ref: { current: container }, active, onDismiss: () => { dismissCount += 1; } }),
      { initialProps: { active: true } },
    );

    rerender({ active: false });
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(dismissCount).toBe(0);
  });

  it("treats a pointerdown inside any of multiple refs as inside", () => {
    const panel = makeContainer();
    const anchor = makeContainer();
    let dismissCount = 0;
    renderHook(() =>
      useDismissablePortal({ refs: [{ current: panel }, { current: anchor }], active: true, onDismiss: () => { dismissCount += 1; } }),
    );

    panel.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    anchor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(dismissCount).toBe(0);

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(dismissCount).toBe(1);
  });

  it("spares a pointerdown whose target matches ignoreSelector", () => {
    const panel = makeContainer();
    const ignored = document.createElement("div");
    ignored.setAttribute("data-keep-open", "true");
    document.body.appendChild(ignored);
    let dismissCount = 0;
    renderHook(() =>
      useDismissablePortal({
        refs: [{ current: panel }],
        ignoreSelector: "[data-keep-open='true']",
        active: true,
        onDismiss: () => { dismissCount += 1; },
      }),
    );

    ignored.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(dismissCount).toBe(0);

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(dismissCount).toBe(1);
  });
});
