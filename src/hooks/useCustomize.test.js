import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import useCustomize from "./useCustomize";

function serifLinks() {
  return Array.from(document.querySelectorAll("link[data-serif-font]"));
}

beforeEach(() => {
  localStorage.clear();
  serifLinks().forEach((link) => link.remove());
  // Stop happy-dom from actually fetching the injected Google Fonts stylesheet.
  if (globalThis.happyDOM?.settings) {
    globalThis.happyDOM.settings.disableCSSFileLoading = true;
  }
});

afterEach(() => {
  serifLinks().forEach((link) => link.remove());
  localStorage.clear();
});

describe("useCustomize alternate-serif lazy loading", () => {
  it("does not inject any alternate serif <link> for the default Instrument Serif", () => {
    renderHook(() => useCustomize());
    expect(serifLinks()).toHaveLength(0);
  });

  it("injects the alternate serif <link> only when a non-default serif is selected", () => {
    const { result } = renderHook(() => useCustomize());

    act(() => {
      result.current.setKey("serifChoice", "Fraunces");
    });

    const links = serifLinks();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("data-serif-font")).toBe("Fraunces");
    expect(links[0].rel).toBe("stylesheet");
    expect(links[0].getAttribute("href")).toContain("family=Fraunces");
  });

  it("injects each alternate serif at most once across reselections", () => {
    const { result } = renderHook(() => useCustomize());

    act(() => result.current.setKey("serifChoice", "IBM Plex Serif"));
    act(() => result.current.setKey("serifChoice", "Instrument Serif"));
    act(() => result.current.setKey("serifChoice", "IBM Plex Serif"));

    const plexLinks = serifLinks().filter(
      (link) => link.getAttribute("data-serif-font") === "IBM Plex Serif",
    );
    expect(plexLinks).toHaveLength(1);
  });

  it("re-injects a previously selected alternate serif restored from storage on mount", () => {
    localStorage.setItem("ea:customize", JSON.stringify({ serifChoice: "Fraunces" }));

    renderHook(() => useCustomize());

    const links = serifLinks();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("data-serif-font")).toBe("Fraunces");
  });
});
