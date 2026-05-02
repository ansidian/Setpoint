import { useState, useEffect, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import Section from "../layout/Section";
import useIsMobile from "../../hooks/useIsMobile";
import NextWeekView from "./schedule/NextWeekView.jsx";
import TodayScheduleView from "./schedule/TodayScheduleView.jsx";
import { derivePassedState } from "./schedule/scheduleModel.js";
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
        <TodayScheduleView
          liveCalendar={liveCalendar}
          tomorrowCalendar={tomorrowCalendar}
          showSource={showSource}
          todayEmpty={todayEmpty}
          hasTomorrow={hasTomorrow}
          timelineRef={timelineRef}
          nowMarkerRef={nowMarkerRef}
          listRef={listRef}
          cardRefsRef={cardRefsRef}
          onTimelineScroll={() => {
            lastUserScrollRef.current = Date.now();
          }}
          nowTime={nowTime}
          markerTop={markerTop}
          textSpan={textSpan}
          flagInset={flagInset}
          inProgressIdx={inProgressIdx}
        />
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
