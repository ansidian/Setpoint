import { CalendarDays, Check, RefreshCw } from "lucide-react";
import type { CSSProperties } from "react";
import Tooltip from "../../shared/Tooltip";
import { TimelineClock } from "./TimelineClock";
import type { TimelineFilters } from "./timeline-helpers";
import "./timeline-presentation.css";

export default function TimelineHeader({
  accent, filters, isMobile = false, now, onToggleFilter, showRefreshStatus = false, todayLabel,
}: {
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
    </div>
    <div className="timeline-header-controls">
      {showRefreshStatus && <span className="timeline-refresh" data-testid="timeline-refresh-status" role="status" aria-live="polite"><RefreshCw size={12} aria-hidden="true" />Updating timeline</span>}
      <div className="timeline-filters" role="group" aria-label="Timeline filters">
        {([{ id: "events", label: "Events" }, { id: "deadlines", label: "Deadlines" }] as const).map(({ id, label }) => <button key={id} type="button" className="timeline-filter" role="switch" aria-checked={filters[id]} onClick={() => onToggleFilter(id)}>
          <Check size={11} aria-hidden="true" />{label}
        </button>)}
      </div>
    </div>
  </div>;
}
