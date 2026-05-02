import { useState, useEffect, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import Section from "../layout/Section";
import useIsMobile from "../../hooks/useIsMobile";
import NowMarker from "./schedule/NowMarker.jsx";
import { buildWeekDays, derivePassedState } from "./schedule/scheduleModel.js";
import useNowMarkerLayout from "./schedule/useNowMarkerLayout.js";

function useNowTick() {
  const fmt = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const [time, setTime] = useState(fmt);
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => {
      setTime(fmt());
      setTick(t => t + 1);
      setNowMs(Date.now());
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  return { time, tick, nowMs };
}

function TomorrowEventList({ events, showSource, opacity }) {
  return events.map((event, i) => (
    <div key={`tomorrow-${i}`}>
      <div
        className={cn(
          "group relative flex items-center gap-3 py-2 px-3 rounded-md transition-all duration-200",
          event.flag === "Conflict"
            ? "bg-destructive/[0.05]"
            : "bg-card/60",
        )}
        style={{
          border: event.flag === "Conflict"
            ? "1px solid rgba(243,139,168,0.2)"
            : "1px solid rgba(255,255,255,0.04)",
          opacity,
        }}
      >
        <div
          className="absolute -left-5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full shrink-0"
          style={{ background: event.color, opacity: 0.4 }}
        />
        <div
          className="absolute left-0 top-3 bottom-3 w-px rounded-full"
          style={{ background: event.color, opacity: 0.4 }}
        />
        <div className="min-w-[72px] ml-1">
          <div className="text-[13px] font-semibold tabular-nums text-foreground">
            {event.time}
          </div>
          <div className="text-[10px] max-sm:text-xs text-muted-foreground/50">
            {event.duration}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium truncate text-foreground/90">
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
                style={{ background: event.color, opacity: 0.7 }}
              />
              {event.source}
            </span>
          )}
        </div>
        {event.flag && (
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
  ));
}

function TomorrowDivider() {
  return (
    <div className="relative flex items-center gap-2 py-3 my-1">
      <div
        className="absolute left-[-20px] w-[11px] h-[11px] rounded-full"
        style={{
          border: "2px solid rgba(203,166,218,0.4)",
          background: "#16161e",
        }}
      />
      <span
        className="text-[10px] max-sm:text-xs font-bold tracking-[1.5px] uppercase"
        style={{ color: "rgba(203,166,218,0.5)" }}
      >
        Tomorrow
      </span>
      <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

function EventCard({ event, showSource }) {
  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 py-2 px-3 rounded-md transition-all duration-200",
        event.flag === "Conflict"
          ? "bg-destructive/[0.05]"
          : "bg-card/60",
        "hover:bg-card/80",
      )}
      style={{
        border: event.flag === "Conflict"
          ? "1px solid rgba(243,139,168,0.2)"
          : "1px solid rgba(255,255,255,0.04)",
      }}
    >
      {/* Color accent bar */}
      <div
        className="absolute left-0 top-3 bottom-3 w-px rounded-full"
        style={{
          background: event.color,
          opacity: 0.7,
          boxShadow: `0 0 6px ${event.color}30`,
        }}
      />

      {/* Time + duration */}
      <div className="min-w-[72px] ml-1">
        <div className="text-[13px] font-semibold tabular-nums text-foreground">
          {event.time}
        </div>
        <div className="text-[10px] max-sm:text-xs text-muted-foreground/50">
          {event.duration}
        </div>
      </div>

      {/* Title + source */}
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium truncate text-foreground/90">
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
              style={{ background: event.color, opacity: 0.7 }}
            />
            {event.source}
          </span>
        )}
      </div>

      {/* Flags */}
      {event.flag && (
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
  );
}

function NextWeekView({ events, showSource, scrollRef }) {
  const containerRef = useRef(null);
  const days = buildWeekDays(events);

  // Restore scroll position on mount
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

export default function ScheduleSection({ calendar, tomorrowCalendar, nextWeekCalendar, loaded, delay, style, className }) {
  const isMobile = useIsMobile();
  const { time: nowTime, tick, nowMs } = useNowTick();
  const [view, setView] = useState("today");
  const nextWeekScrollRef = useRef(0);
  const nowMarkerRef = useRef(null);
  const timelineRef = useRef(null);
  const lastUserScrollRef = useRef(0);
  const cardRefsRef = useRef([]);
  const listRef = useRef(null);

  // Derive passed state client-side so the now marker moves live
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick forces recomputation every minute
  const liveCalendar = useMemo(() => derivePassedState(calendar), [calendar, tick]);
  const hasTomorrow = tomorrowCalendar?.length > 0;
  const todayEmpty = !liveCalendar?.length;

  const activeEvents = view === "today" ? liveCalendar : nextWeekCalendar;
  const sources = new Set([
    ...(activeEvents?.map(e => e.source).filter(Boolean) || []),
    ...(view === "today" && hasTomorrow ? tomorrowCalendar.map(e => e.source).filter(Boolean) : []),
  ]);
  const showSource = sources.size > 1;

  const prevMarkerTopRef = useRef(null);
  const { markerTop, inProgressIdx, textSpan, flagInset } = useNowMarkerLayout({
    view,
    liveCalendar,
    nowMs,
    cardRefsRef,
  });

  // Smooth scroll to now marker on mount and briefing refresh (desktop only)
  useEffect(() => {
    if (isMobile || view !== "today") return;
    const el = timelineRef.current;
    if (!el || el.scrollHeight <= el.clientHeight) return;
    const target = inProgressIdx >= 0
      ? cardRefsRef.current[inProgressIdx]
      : nowMarkerRef.current;
    if (!target) return;
    const timer = setTimeout(() => {
      el.scrollTo({ top: Math.max(0, target.offsetTop - 16), behavior: "smooth" });
    }, 300);
    return () => clearTimeout(timer);
  }, [calendar, view, isMobile, inProgressIdx]);

  // Auto-scroll when marker jumps significantly (desktop only)
  useEffect(() => {
    if (isMobile || view !== "today" || markerTop == null) return;
    const el = timelineRef.current;
    if (!el || el.scrollHeight <= el.clientHeight) return;
    const prev = prevMarkerTopRef.current;
    prevMarkerTopRef.current = markerTop;
    // Only scroll on large jumps (crossed a card), not smooth per-tick movement
    if (prev != null && Math.abs(markerTop - prev) < 20) return;

    // Skip if user scrolled within last 10 seconds
    if (Date.now() - lastUserScrollRef.current < 10_000) return;

    const target = inProgressIdx >= 0
      ? cardRefsRef.current[inProgressIdx]
      : nowMarkerRef.current;
    if (!target) return;
    el.scrollTo({ top: Math.max(0, target.offsetTop - 16), behavior: "smooth" });
  }, [markerTop, view, isMobile, inProgressIdx]);

  const titleContent = (
    <div className="flex items-center gap-3">
      <button
        onClick={(e) => { e.stopPropagation(); setView("today"); }}
        className={cn(
          "text-[11px] max-sm:text-xs tracking-[2.5px] uppercase font-semibold transition-colors duration-200",
          view === "today"
            ? "text-foreground/40"
            : "text-foreground/15 hover:text-foreground/25",
        )}
      >
        Today
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setView("next-week"); }}
        className={cn(
          "text-[11px] max-sm:text-xs tracking-[2.5px] uppercase font-semibold transition-colors duration-200",
          view === "next-week"
            ? "text-foreground/40"
            : "text-foreground/15 hover:text-foreground/25",
        )}
      >
        Next Week
      </button>
    </div>
  );

  return (
    <Section
      title={titleContent}
      delay={delay}
      loaded={loaded}
      variant="band"
      style={style}
      className={className}
      tier={2}
      summaryBadge={`${activeEvents?.length || 0} event${(activeEvents?.length || 0) !== 1 ? "s" : ""}`}
      defaultExpanded
    >
      {view === "today" && (
        <>
          {liveCalendar?.length > 0 ? (
            <div
              ref={timelineRef}
              className="max-h-[400px] overflow-y-auto"
              style={{ overscrollBehavior: "contain" }}
              onScroll={() => {
                lastUserScrollRef.current = Date.now();
              }}
            >
              <div className="relative pl-5 pb-5">
                {/* Timeline spine */}
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
                      {/* Event card */}
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
                        {/* Timeline dot — on the spine */}
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

                        {/* Color accent bar */}
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

                        {/* Time + duration */}
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

                        {/* Title + source */}
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

                        {/* Flags */}
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

                  {/* Tomorrow's events on the continuous timeline */}
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
          ) : hasTomorrow ? (
            <div
              ref={timelineRef}
              className="max-h-[400px] overflow-y-auto"
              style={{ overscrollBehavior: "contain" }}
              onScroll={() => {
                lastUserScrollRef.current = Date.now();
              }}
            >
              <div className="relative pl-5">
                {/* Timeline spine */}
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
          ) : (
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
          )}
        </>
      )}

      {view === "next-week" && (
        <NextWeekView
          events={nextWeekCalendar}
          showSource={showSource}
          scrollRef={nextWeekScrollRef}
        />
      )}
    </Section>
  );
}
