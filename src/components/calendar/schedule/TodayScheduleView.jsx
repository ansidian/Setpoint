import { cn } from "@/lib/utils";
import NowMarker from "./NowMarker.jsx";
import TomorrowDivider from "./TomorrowDivider.jsx";
import TomorrowEventList from "./TomorrowEventList.jsx";

function EmptyScheduleState() {
  return (
    <div className="py-8 text-center">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-auto mb-2.5 text-muted-foreground/20"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      <div className="text-[11px] max-sm:text-xs text-muted-foreground/50">
        No events scheduled today or tomorrow
      </div>
    </div>
  );
}

export default function TodayScheduleView({
  liveCalendar,
  tomorrowCalendar,
  showSource,
  todayEmpty,
  hasTomorrow,
  timelineRef,
  nowMarkerRef,
  listRef,
  cardRefsRef,
  onTimelineScroll,
  nowTime,
  markerTop,
  textSpan,
  flagInset,
  inProgressIdx,
}) {
  if (liveCalendar?.length > 0) {
    return (
      <div
        ref={timelineRef}
        className="max-h-[400px] overflow-y-auto"
        style={{ overscrollBehavior: "contain" }}
        onScroll={onTimelineScroll}
      >
        <div className="relative pl-5 pb-5">
          <div
            className="absolute left-[5px] top-2 bottom-2 w-px"
            style={{ background: "rgba(255,255,255,0.06)" }}
          />

          {markerTop != null && (
            <NowMarker
              ref={nowMarkerRef}
              time={nowTime}
              top={markerTop}
              textSpan={textSpan}
              flagInset={flagInset}
            />
          )}

          <div ref={listRef} className="flex flex-col gap-1">
            {liveCalendar.map((event, i) => (
              <div
                key={i}
                ref={(el) => {
                  cardRefsRef.current[i] = el;
                }}
              >
                <div
                  className={cn(
                    "group relative flex items-center gap-3 py-2 px-3 rounded-md transition-all duration-200",
                    event.flag === "Conflict"
                      ? "bg-destructive/[0.05]"
                      : "bg-card/60",
                    event.passed ? "opacity-40" : "hover:bg-card/80",
                  )}
                  style={{
                    border:
                      i === inProgressIdx
                        ? "1px solid rgba(203,166,218,0.15)"
                        : event.flag === "Conflict"
                          ? "1px solid rgba(243,139,168,0.2)"
                          : "1px solid rgba(255,255,255,0.04)",
                    ...(i === inProgressIdx && {
                      boxShadow:
                        "0 0 12px rgba(203,166,218,0.06), inset 0 0 0 1px rgba(203,166,218,0.05)",
                    }),
                  }}
                >
                  <div
                    className="absolute -left-5 top-1/2 -translate-y-1/2 w-[7px] h-[7px] rounded-full shrink-0 transition-all duration-200"
                    style={{
                      background: event.passed
                        ? "rgba(255,255,255,0.1)"
                        : i === inProgressIdx
                          ? "#cba6da"
                          : event.color,
                      boxShadow: event.passed
                        ? "none"
                        : i === inProgressIdx
                          ? "0 0 8px rgba(203,166,218,0.5)"
                          : `0 0 6px ${event.color}50`,
                    }}
                  />

                  <div
                    className="absolute left-0 top-3 bottom-3 w-px rounded-full"
                    style={{
                      background: event.color,
                      opacity: event.passed ? 0.3 : 0.7,
                      boxShadow: event.passed
                        ? "none"
                        : `0 0 6px ${event.color}30`,
                    }}
                  />

                  <div className="min-w-[72px] ml-1">
                    <div
                      className={cn(
                        "text-[13px] font-semibold tabular-nums",
                        event.passed
                          ? "text-muted-foreground"
                          : "text-foreground",
                      )}
                    >
                      {event.time}
                    </div>
                    <div className="text-[10px] max-sm:text-xs text-muted-foreground/50">
                      {event.duration}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        "text-[12px] font-medium truncate",
                        event.passed
                          ? "text-muted-foreground line-through decoration-muted-foreground/30"
                          : "text-foreground/90",
                      )}
                    >
                      {event.title}
                    </div>
                    {showSource && event.source && (
                      <span
                        className="inline-flex items-center gap-1 mt-0.5 text-[10px] max-sm:text-xs font-medium rounded px-1.5 py-px"
                        style={{
                          color: `${event.color}cc`,
                          background: `${event.color}10`,
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{
                            background: event.color,
                            opacity: 0.7,
                          }}
                        />
                        {event.source}
                      </span>
                    )}
                  </div>

                  {!event.passed && event.flag && (
                    <div
                      className={cn(
                        "text-[9px] max-sm:text-xs font-semibold tracking-wider uppercase py-1 px-2 rounded-md shrink-0",
                        event.flag === "Conflict"
                          ? "text-[#f38ba8] bg-[#f38ba8]/[0.08]"
                          : "text-[#f9e2af] bg-[#f9e2af]/[0.08]",
                      )}
                    >
                      {event.flag}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {hasTomorrow && (
              <>
                <TomorrowDivider />
                <TomorrowEventList
                  events={tomorrowCalendar}
                  showSource={showSource}
                  opacity={todayEmpty ? 0.65 : 0.55}
                />
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (hasTomorrow) {
    return (
      <div
        ref={timelineRef}
        className="max-h-[400px] overflow-y-auto"
        style={{ overscrollBehavior: "contain" }}
        onScroll={onTimelineScroll}
      >
        <div className="relative pl-5">
          <div
            className="absolute left-[5px] top-2 bottom-2 w-px"
            style={{ background: "rgba(255,255,255,0.06)" }}
          />
          <div className="flex flex-col gap-1">
            <NowMarker ref={nowMarkerRef} time={nowTime} />
            <TomorrowDivider />
            <TomorrowEventList
              events={tomorrowCalendar}
              showSource={showSource}
              opacity={0.65}
            />
          </div>
        </div>
      </div>
    );
  }

  return <EmptyScheduleState />;
}
