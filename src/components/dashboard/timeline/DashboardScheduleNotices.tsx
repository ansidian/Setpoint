import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Car } from "lucide-react";
import { listReminders } from "@/api";
import type { Reminder } from "../../../../shared/types/reminders";
import AnimatedHeight from "../../shared/AnimatedHeight";
import { buildDashboardScheduleNotices, type ScheduleNoticeEvent } from "./dashboardScheduleModel";
import "./DashboardScheduleNotices.css";

export type { ScheduleNoticeEvent } from "./dashboardScheduleModel";

interface DashboardScheduleNoticesProps {
  events: readonly ScheduleNoticeEvent[];
  onOpenEvent: (event: ScheduleNoticeEvent, anchor: HTMLElement) => void;
  refreshKey?: string | number;
}

const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit",
});

function checkedAge(value: string, now: number) {
  const checked = new Date(value).getTime();
  if (!Number.isFinite(checked)) return "Check time unavailable";
  const minutes = Math.max(0, Math.floor((now - checked) / 60_000));
  if (minutes < 1) return "Checked just now";
  if (minutes < 60) return `Checked ${minutes}m ago`;
  if (minutes < 1440) return `Checked ${Math.floor(minutes / 60)}h ago`;
  return `Checked ${Math.floor(minutes / 1440)}d ago`;
}

export function DashboardScheduleNotices({ events, onOpenEvent, refreshKey }: DashboardScheduleNoticesProps) {
  const [now, setNow] = useState(Date.now);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [readFailed, setReadFailed] = useState(false);
  const schedule = useMemo(() => buildDashboardScheduleNotices(events, reminders, now), [events, reminders, now]);
  const hasRemainingEvents = schedule.hasRemainingEvents;
  const eventIdentityKey = JSON.stringify(events.map((event) => [event.accountId, event.calendarId, event.id, event.originalStartTime, event.startMs, event.endMs]));

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let lastRead = 0;
    const refresh = async (force = false) => {
      const current = Date.now();
      setNow(current);
      if (!hasRemainingEvents || inFlight || (!force && current - lastRead < 300_000)) return;
      inFlight = true;
      lastRead = current;
      try {
        const result = await listReminders({ sourceType: "calendar_event" });
        if (!cancelled) {
          setReminders(result.reminders);
          setReadFailed(false);
        }
      } catch {
        if (!cancelled) setReadFailed(true);
      } finally {
        inFlight = false;
      }
    };
    const onFocus = () => { void refresh(true); };
    const tick = () => { void refresh(); };
    void refresh(true);
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshKey, hasRemainingEvents, eventIdentityKey]);

  const departure = schedule.departure;
  const conflict = schedule.conflicts[0];
  const uncertainRoute = departure && (readFailed || departure.reminder.route_status !== "ready");

  return (
    <AnimatedHeight>
      {(departure || conflict || (readFailed && hasRemainingEvents)) && (
        <div className="dashboard-schedule-notices" aria-label="Schedule notices">
          {departure && (
            <button type="button" className="dashboard-schedule-notice" onClick={(event) => onOpenEvent(departure.event, event.currentTarget)}>
              <Car size={15} aria-hidden="true" />
              <span className="dashboard-schedule-notice__copy">
                <span className="dashboard-schedule-notice__heading">
                  {uncertainRoute ? "Previous departure estimate" : departure.departureMs <= now ? "Departure was" : "Leave by"} {clock.format(departure.departureMs)}
                  <span className="dashboard-schedule-notice__event">{departure.event.title}</span>
                </span>
                <span className="dashboard-schedule-notice__detail">
                  From Home · about {Math.max(1, Math.round(departure.reminder.route_duration_seconds / 60))} min drive · {departure.reminder.arrival_buffer_minutes} min arrival buffer
                </span>
                <span className="dashboard-schedule-notice__detail">
                  {uncertainRoute ? "Estimate needs refresh · " : ""}{checkedAge(departure.reminder.route_checked_at, now)}
                  {departure.reminder.status === "sent" ? " · Reminder delivered" : ""}
                </span>
              </span>
              <ArrowUpRight size={13} aria-hidden="true" />
            </button>
          )}
          {conflict && (
            <button type="button" className="dashboard-schedule-notice dashboard-schedule-notice--conflict" onClick={(event) => onOpenEvent(conflict.first, event.currentTarget)}>
              <AlertTriangle size={15} aria-hidden="true" />
              <span className="dashboard-schedule-notice__copy">
                <span className="dashboard-schedule-notice__heading">
                  {schedule.conflicts.length === 1 ? "Schedule overlap" : `${schedule.conflicts.length} schedule overlaps`} · {clock.format(conflict.startMs)}
                </span>
                <span className="dashboard-schedule-notice__detail">{conflict.first.title} and {conflict.second.title}</span>
              </span>
              <ArrowUpRight size={13} aria-hidden="true" />
            </button>
          )}
          {readFailed && hasRemainingEvents && !departure && (
            <p className="dashboard-schedule-notice__unavailable">Departure reminders unavailable. Checking again shortly.</p>
          )}
        </div>
      )}
    </AnimatedHeight>
  );
}
