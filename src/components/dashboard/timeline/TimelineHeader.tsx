import { CalendarDays, Check, ChevronsDownUp, ChevronsUpDown, RefreshCw } from "lucide-react";
import type { CSSProperties } from "react";
import Tooltip from "../../shared/Tooltip";
import { TimelineClock } from "./TimelineClock";
import type { TimelineFilters } from "./timeline-helpers";
import "./timeline-presentation.css";

export default function TimelineHeader({
  accent, filters, isMobile = false, now, onToggleFilter, showRefreshStatus = false, todayLabel, allGroupsCollapsed, onToggleAll,
}: {
  allGroupsCollapsed: boolean;
  onToggleAll?: () => void;
  accent: string;
  filters: TimelineFilters;
  isMobile?: boolean;
  now?: number;
  onToggleFilter: (filter: keyof TimelineFilters) => void;
  showRefreshStatus?: boolean;
  todayLabel?: string;
}) {
  return <div className={`timeline-header${isMobile ? " timeline-header--mobile" : ""}`} style={{ "--timeline-accent": accent } as CSSProperties}>
    <div className="timeline-header-identity">
      <Tooltip text={todayLabel} sideOffset={12}>
        <h2><CalendarDays size={15} aria-hidden="true" />Today</h2>
      </Tooltip>
      {typeof now === "number" && <TimelineClock now={now} />}
      <span className="timeline-refresh-slot">
        <span className="timeline-refresh invisible" aria-hidden="true"><RefreshCw size={12} />Updating timeline</span>
        {showRefreshStatus && <span className="timeline-refresh timeline-refresh-visible" data-testid="timeline-refresh-status" role="status" aria-live="polite"><RefreshCw size={12} aria-hidden="true" />Updating timeline</span>}
      </span>
    </div>
    <div className="timeline-header-controls">
      {onToggleAll && <button type="button" className="timeline-filter" onClick={onToggleAll}
        aria-label={allGroupsCollapsed ? "Expand all timeline groups" : "Collapse all timeline groups"}
        title={allGroupsCollapsed ? "Expand all timeline groups" : "Collapse all timeline groups"}>
        {allGroupsCollapsed ? <ChevronsUpDown size={14} aria-hidden="true" /> : <ChevronsDownUp size={14} aria-hidden="true" />}
      </button>}
      <div className="timeline-filters" role="group" aria-label="Timeline filters">
        {([{ id: "events", label: "Events" }, { id: "deadlines", label: "Deadlines" }] as const).map(({ id, label }) => <button key={id} type="button" className="timeline-filter" role="switch" aria-checked={filters[id]} disabled={filters[id] && !(filters.events && filters.deadlines)} title={filters[id] && !(filters.events && filters.deadlines) ? "Enable the other filter before turning this off" : undefined} onClick={() => onToggleFilter(id)}>
          <Check size={11} aria-hidden="true" />{label}
        </button>)}
      </div>
    </div>
  </div>;
}
