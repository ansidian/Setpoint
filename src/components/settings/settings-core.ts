export const SURFACE_ROW_CLASS =
  "border-t border-white/[0.05] bg-transparent transition-colors first:border-t-0 hover:bg-white/[0.025]";
export const SETTINGS_PRIMARY_BUTTON_CLASS =
  "border border-primary/20 bg-primary/[0.12] text-primary hover:bg-primary/[0.16] hover:border-primary/28 hover:-translate-y-px active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none";
export const SETTINGS_SECONDARY_BUTTON_CLASS =
  "border border-white/[0.08] bg-white/[0.03] text-foreground hover:bg-white/[0.05] hover:border-white/[0.14] hover:-translate-y-px active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none";
export const SETTINGS_GHOST_BUTTON_CLASS =
  "border border-transparent bg-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground hover:border-white/[0.08] active:bg-white/[0.06] motion-reduce:transition-none motion-reduce:transform-none";

export const TABS = [
  { id: "connections", label: "Connections" },
  { id: "automation", label: "Automation" },
  { id: "finance", label: "Finance" },
  { id: "system", label: "System" },
] as const;

export type SettingsTab = typeof TABS[number]["id"];

const LEGACY_TAB_ALIASES: Record<string, SettingsTab> = {
  accounts: "connections",
  briefing: "automation",
  actual: "finance",
};

export function normalizeSettingsTab(tab: unknown): SettingsTab {
  if (typeof tab === "string" && tab in LEGACY_TAB_ALIASES) {
    return LEGACY_TAB_ALIASES[tab]!;
  }
  return TABS.some((entry) => entry.id === tab) ? tab as SettingsTab : "connections";
}

export function readTabFromURL() {
  try {
    return normalizeSettingsTab(new URLSearchParams(window.location.search).get("tab"));
  } catch {
    return "connections";
  }
}

export function readTabFromSearchParams(searchParams?: Pick<URLSearchParams, "get"> | null) {
  return normalizeSettingsTab(searchParams?.get("tab"));
}
