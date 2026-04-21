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
  showNotes: true,
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

export default function useCustomize() {
  const [state, setState] = useState(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* quota or disabled */ }
  }, [state]);

  useEffect(() => {
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
