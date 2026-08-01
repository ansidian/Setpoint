import type { ReactNode } from "react";
import { TAB_LABELS } from "../shell/ShellTabs";
import type { DashboardTab } from "./dashboardShellModel";
import KeepAliveTab from "./KeepAliveTab";

interface DashboardTabPanelProps {
  tab: DashboardTab;
  active: boolean;
  isMobile: boolean;
  children: ReactNode;
}

/**
 * Keeps dashboard shell tabs mounted and gives each one a correctly named
 * tabpanel. Desktop panels reference ShellTabs; mobile panels use a direct
 * label because the desktop tablist is not rendered there.
 */
export default function DashboardTabPanel({
  tab,
  active,
  isMobile,
  children,
}: DashboardTabPanelProps) {
  const accessibleName = isMobile
    ? { "aria-label": TAB_LABELS[tab] }
    : { "aria-labelledby": `shell-tab-${tab}` };

  return (
    <KeepAliveTab active={active}>
      <div
        role="tabpanel"
        id={`shell-tabpanel-${tab}`}
        {...accessibleName}
        style={{ display: "contents" }}
      >
        {children}
      </div>
    </KeepAliveTab>
  );
}
