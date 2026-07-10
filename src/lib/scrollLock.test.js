import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireScrollLock } from "./scrollLock.js";

describe("acquireScrollLock", () => {
  let target;

  beforeEach(() => {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    target = document.createElement("div");
    target.setAttribute("data-scroll-lock-target", "");
    target.style.overflow = "auto";
    document.body.appendChild(target);
  });

  afterEach(() => {
    target.remove();
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
  });

  it("hides overflow on body, documentElement, and data-scroll-lock-target elements, then restores on release", () => {
    const release = acquireScrollLock();

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(target.style.overflow).toBe("hidden");

    release();

    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
    expect(target.style.overflow).toBe("auto");
  });

  it("keeps everything locked across a nested acquire until the last release (ref-counted)", () => {
    const releaseA = acquireScrollLock();
    const releaseB = acquireScrollLock();

    expect(document.body.style.overflow).toBe("hidden");

    releaseA();
    expect(document.body.style.overflow).toBe("hidden");

    releaseB();
    expect(document.body.style.overflow).toBe("");
  });

  it("is a no-op to release the same handle twice", () => {
    const releaseA = acquireScrollLock();
    const releaseB = acquireScrollLock();

    releaseA();
    releaseA();
    expect(document.body.style.overflow).toBe("hidden");

    releaseB();
    expect(document.body.style.overflow).toBe("");
  });

  it("survives an interleaved acquire/release order (the ARCH-04 stacking sequence)", () => {
    const releaseA = acquireScrollLock();
    const releaseB = acquireScrollLock();
    releaseA();
    expect(document.body.style.overflow).toBe("hidden");
    releaseB();
    expect(document.body.style.overflow).toBe("");
  });
});
