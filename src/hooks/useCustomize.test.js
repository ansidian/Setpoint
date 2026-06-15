import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import useCustomize, { DEFAULTS } from "./useCustomize";

const STORAGE_KEY = "ea:customize";

// Observable: the on-demand serif families are loaded by appending a
// <link rel="stylesheet"> to <head> whose href pulls the Google Fonts family.
// We identify them by the loaded family, not by any internal marker attribute.
function fontLinks() {
  return Array.from(
    document.querySelectorAll('head link[rel="stylesheet"]'),
  ).filter((link) => (link.getAttribute("href") || "").includes("fonts.googleapis.com"));
}

function fontLinksForFamily(familyQuery) {
  return fontLinks().filter((link) =>
    (link.getAttribute("href") || "").includes(familyQuery),
  );
}

function readPersisted() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY));
}

beforeEach(() => {
  localStorage.clear();
  fontLinks().forEach((link) => link.remove());
  document.documentElement.removeAttribute("style");
  // Stop happy-dom from actually fetching the injected Google Fonts stylesheet.
  if (globalThis.happyDOM?.settings) {
    globalThis.happyDOM.settings.disableCSSFileLoading = true;
  }
});

afterEach(() => {
  fontLinks().forEach((link) => link.remove());
  document.documentElement.removeAttribute("style");
  localStorage.clear();
});

describe("useCustomize alternate-serif lazy loading", () => {
  it("does not inject any alternate serif <link> for the default Instrument Serif", () => {
    renderHook(() => useCustomize());
    expect(fontLinks()).toHaveLength(0);
  });

  it("appends a stylesheet <link> loading the Fraunces family when Fraunces is selected", () => {
    const { result } = renderHook(() => useCustomize());

    act(() => {
      result.current.setKey("serifChoice", "Fraunces");
    });

    const links = fontLinksForFamily("family=Fraunces");
    expect(links).toHaveLength(1);
    expect(links[0].rel).toBe("stylesheet");
    expect(links[0].parentElement).toBe(document.head);
    expect(links[0].getAttribute("href")).toContain("fonts.googleapis.com");
  });

  it("appends a stylesheet <link> loading the IBM Plex Serif family when selected", () => {
    const { result } = renderHook(() => useCustomize());

    act(() => {
      result.current.setKey("serifChoice", "IBM Plex Serif");
    });

    const links = fontLinksForFamily("family=IBM+Plex+Serif");
    expect(links).toHaveLength(1);
    expect(links[0].rel).toBe("stylesheet");
    expect(links[0].parentElement).toBe(document.head);
  });

  it("loads each alternate serif family at most once across reselections", () => {
    const { result } = renderHook(() => useCustomize());

    act(() => result.current.setKey("serifChoice", "IBM Plex Serif"));
    act(() => result.current.setKey("serifChoice", "Instrument Serif"));
    act(() => result.current.setKey("serifChoice", "IBM Plex Serif"));

    expect(fontLinksForFamily("family=IBM+Plex+Serif")).toHaveLength(1);
  });

  it("re-injects a previously selected alternate serif restored from storage on mount", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ serifChoice: "Fraunces" }));

    renderHook(() => useCustomize());

    expect(fontLinksForFamily("family=Fraunces")).toHaveLength(1);
  });
});

describe("useCustomize persistence", () => {
  it("persists the full merged state to localStorage when a key is set", () => {
    const { result } = renderHook(() => useCustomize());

    act(() => {
      result.current.setKey("density", "compact");
    });

    const persisted = readPersisted();
    // The changed key is written...
    expect(persisted.density).toBe("compact");
    // ...merged on top of the defaults, not replacing them.
    expect(persisted).toEqual({ ...DEFAULTS, density: "compact" });
  });

  it("persists later edits on top of earlier ones", () => {
    const { result } = renderHook(() => useCustomize());

    act(() => result.current.setKey("accent", "#112233"));
    act(() => result.current.setKey("dashboardLayout", "command"));

    const persisted = readPersisted();
    expect(persisted.accent).toBe("#112233");
    expect(persisted.dashboardLayout).toBe("command");
    expect(persisted).toEqual({
      ...DEFAULTS,
      accent: "#112233",
      dashboardLayout: "command",
    });
  });
});

describe("useCustomize reset", () => {
  it("restores DEFAULTS in the returned state and re-persists them", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ density: "compact", accent: "#000000", serifChoice: "Fraunces" }),
    );

    const { result } = renderHook(() => useCustomize());

    // Sanity: started from the persisted (non-default) values.
    expect(result.current.density).toBe("compact");
    expect(result.current.accent).toBe("#000000");

    act(() => {
      result.current.reset();
    });

    // Returned state reflects DEFAULTS for every key.
    expect(result.current.density).toBe(DEFAULTS.density);
    expect(result.current.accent).toBe(DEFAULTS.accent);
    expect(result.current.serifChoice).toBe(DEFAULTS.serifChoice);

    // And the defaults are written back to storage.
    expect(readPersisted()).toEqual(DEFAULTS);
  });
});

describe("useCustomize CSS custom properties", () => {
  it("sets --serif-choice and --ea-accent to the defaults on mount", () => {
    renderHook(() => useCustomize());

    const root = document.documentElement;
    expect(root.style.getPropertyValue("--serif-choice")).toBe(
      `"${DEFAULTS.serifChoice}"`,
    );
    expect(root.style.getPropertyValue("--ea-accent")).toBe(DEFAULTS.accent);
  });

  it("updates --serif-choice on documentElement when a serif is selected", () => {
    const { result } = renderHook(() => useCustomize());

    act(() => {
      result.current.setKey("serifChoice", "Fraunces");
    });

    expect(document.documentElement.style.getPropertyValue("--serif-choice")).toBe(
      '"Fraunces"',
    );
  });

  it("updates --ea-accent on documentElement when an accent is selected", () => {
    const { result } = renderHook(() => useCustomize());

    act(() => {
      result.current.setKey("accent", "#ff8800");
    });

    expect(document.documentElement.style.getPropertyValue("--ea-accent")).toBe(
      "#ff8800",
    );
  });
});
