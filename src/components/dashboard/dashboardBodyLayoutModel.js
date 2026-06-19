export function resolveDashboardBodyLayout({
  isMobile = false,
  dashboardLayout = "focus",
  showInboxPeek = false,
} = {}) {
  const layoutMode = isMobile ? "paper" : dashboardLayout;
  const inboxSections = showInboxPeek ? ["inbox-peek"] : [];

  return {
    layoutMode,
    mobileSectionOrder: ["deadlines", "bills", ...inboxSections],
    primaryRailSectionOrder: ["deadlines", "bills", ...inboxSections],
    commandPrimaryRailSectionOrder: ["deadlines"],
    commandSecondaryRailSectionOrder: ["bills", ...inboxSections],
  };
}
