export function resolveDashboardBodyLayout({
  isMobile = false,
  dashboardLayout = "focus",
  showInboxPeek = false,
  showNotes = false,
} = {}) {
  const layoutMode = isMobile ? "paper" : dashboardLayout;
  const inboxSections = showInboxPeek ? ["inbox-peek"] : [];
  const notesSections = showNotes ? ["notes"] : [];

  return {
    layoutMode,
    mobileSectionOrder: ["deadlines", "bills", ...inboxSections],
    primaryRailSectionOrder: ["deadlines", "bills", ...inboxSections],
    commandPrimaryRailSectionOrder: ["deadlines", ...notesSections],
    commandSecondaryRailSectionOrder: ["bills", ...inboxSections],
  };
}
