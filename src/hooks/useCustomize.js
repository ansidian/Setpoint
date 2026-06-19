import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "ea:customize";

const DEFAULTS = {
  dashboardLayout: "focus",      // focus | command | paper
  inboxLayout: "two-pane",       // two-pane | three-pane | list-only
  inboxGrouping: "swimlanes",    // swimlanes | flat
  density: "comfortable",        // comfortable | compact
  inboxDensity: "default",       // compact | default | comfortable
  aiVerbosity: "standard",       // minimal | standard | full
  accent: "#cba6da",
  serifChoice: "Instrument Serif",
  showInsights: true,
  showInboxPeek: true,
  showPreview: true,
  sidebarCompact: false,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

// The default serif (Instrument Serif) ships in the up-front index.html font
// <link>. The alternate serif families are only loaded on demand, the first
// time the user actually selects them in Customize, to keep them off the
// render-blocking cold-load path. Idempotent: each href is injected at most
// once per document.
const ALTERNATE_SERIF_FONT_HREFS = {
  "Fraunces": "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&display=swap",
  "IBM Plex Serif": "https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@300;400;500&display=swap",
};

function ensureSerifFontLoaded(serifChoice) {
  const href = ALTERNATE_SERIF_FONT_HREFS[serifChoice];
  if (!href || typeof document === "undefined") return;
  if (document.querySelector(`link[data-serif-font="${serifChoice}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-serif-font", serifChoice);
  document.head.appendChild(link);
}

export default function useCustomize() {
  const [state, setState] = useState(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* quota or disabled */ }
  }, [state]);

  useEffect(() => {
    ensureSerifFontLoaded(state.serifChoice);
    document.documentElement.style.setProperty("--serif-choice", `"${state.serifChoice}"`);
    document.documentElement.style.setProperty("--ea-accent", state.accent);
  }, [state.serifChoice, state.accent]);

  const setKey = useCallback((key, value) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setState(DEFAULTS), []);

  return { ...state, setKey, reset };
}

export { DEFAULTS };
