import { ChevronRight } from "lucide-react";
import TimelineDayGroup from "./TimelineDayGroup";
import { partitionTodayEvents } from "./timeline-helpers";
import type { DashboardTimelineItem } from "./timeline-helpers";
import type { TimelineRowJumpPayload } from "./TimelineRow";

export default function MobileTodayTimeline({ items, now, accent, onJump, showEmptyState, emptyDescription }: {
  items: DashboardTimelineItem[];
  now: number;
  accent: string;
  onJump?: (payload: TimelineRowJumpPayload, anchor: HTMLElement) => void;
  showEmptyState: boolean;
  emptyDescription: string;
}) {
  const { earlier, remaining } = partitionTodayEvents(items, now);

  return (
    <>
      {earlier.length > 0 && (
        <details className="timeline-earlier">
          <summary className="timeline-mobile-control">
            <ChevronRight size={14} aria-hidden="true" />
            <span>Earlier today</span>
            <span className="timeline-earlier-count">{earlier.length} {earlier.length === 1 ? "event" : "events"}</span>
          </summary>
          <TimelineDayGroup
            day={0}
            hideDayHeader
            items={earlier}
            now={now}
            accent={accent}
            onJump={onJump}
            isMobile
          />
        </details>
      )}
      {(remaining.length > 0 || earlier.length === 0) && (
        <TimelineDayGroup
          day={0}
          isFirst
          items={remaining}
          now={now}
          accent={accent}
          onJump={onJump}
          isMobile
          showEmptyState={showEmptyState}
          emptyDescription={emptyDescription}
        />
      )}
    </>
  );
}
