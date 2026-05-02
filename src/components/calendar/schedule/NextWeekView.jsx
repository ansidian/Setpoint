import { useEffect, useRef } from "react";
import EventCard from "./EventCard.jsx";
import { buildWeekDays } from "./scheduleModel.js";

export default function NextWeekView({ events, showSource, scrollRef }) {
  const containerRef = useRef(null);
  const days = buildWeekDays(events);

  useEffect(() => {
    if (containerRef.current && scrollRef.current) {
      containerRef.current.scrollTop = scrollRef.current;
    }
  }, [scrollRef]);

  if (days.length === 0) {
    return (
      <div className="py-8 text-center">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2.5 text-muted-foreground/20">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <div className="text-[11px] max-sm:text-xs text-muted-foreground/50">No events scheduled next week</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-3 max-h-[360px] overflow-y-auto"
      onScroll={(e) => { scrollRef.current = e.target.scrollTop; }}
    >
      {days.map((day) => (
        <div key={day.label}>
          <div
            className="text-[10px] max-sm:text-xs tracking-[1.5px] uppercase font-bold mb-1.5"
            style={{
              color: day.events.length > 0
                ? "rgba(203,166,218,0.6)"
                : "rgba(255,255,255,0.15)",
            }}
          >
            {day.label}
          </div>
          {day.events.length > 0 ? (
            <div className="flex flex-col gap-1">
              {day.events.map((event, i) => (
                <EventCard key={i} event={event} showSource={showSource} />
              ))}
            </div>
          ) : (
            <div className="text-[11px] max-sm:text-xs text-muted-foreground/30 py-1">
              No events
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
