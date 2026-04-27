export const SURFACE_ROW_CLASS =
  "border-t border-white/[0.05] bg-transparent transition-colors first:border-t-0 hover:bg-white/[0.025]";
export const SETTINGS_PRIMARY_BUTTON_CLASS =
  "border border-primary/20 bg-primary/[0.12] text-primary hover:bg-primary/[0.16] hover:border-primary/28 hover:-translate-y-px active:translate-y-0";
export const SETTINGS_SECONDARY_BUTTON_CLASS =
  "border border-white/[0.08] bg-white/[0.03] text-foreground hover:bg-white/[0.05] hover:border-white/[0.14] hover:-translate-y-px active:translate-y-0";
export const SETTINGS_GHOST_BUTTON_CLASS =
  "border border-transparent bg-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground hover:border-white/[0.08]";

export const TABS = [
  { id: "accounts", label: "Accounts & Integrations" },
  { id: "briefing", label: "Briefing" },
  { id: "system", label: "System" },
];

export function normalizeSettingsTab(tab) {
  return TABS.some((entry) => entry.id === tab) ? tab : "accounts";
}

export function readTabFromURL() {
  try {
    return normalizeSettingsTab(new URLSearchParams(window.location.search).get("tab"));
  } catch {
    return "accounts";
  }
}

export function readTabFromSearchParams(searchParams) {
  return normalizeSettingsTab(searchParams?.get("tab"));
}
