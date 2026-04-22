import { ArrowLeft, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getCalendarViewMeta } from "./calendarEmptyStateMeta.js";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatMonthLabel(viewYear, viewMonth) {
  return new Date(viewYear, viewMonth).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatFullDate(viewYear, viewMonth, day) {
  return new Date(viewYear, viewMonth, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function summarizeDayState(value) {
  if (Array.isArray(value)) {
    return {
      total: value.length,
      active: value.length,
      completed: 0,
    };
  }

  if (value && typeof value === "object" && Array.isArray(value.activeItems)) {
    return {
      total: value.totalCount || 0,
      active: value.activeCount || 0,
      completed: value.completedCount || 0,
    };
  }

  return {
    total: 0,
    active: 0,
    completed: 0,
  };
}

function summarizeMonth(itemsByDay) {
  return Object.values(itemsByDay || {}).reduce((acc, value) => {
    const next = summarizeDayState(value);
    acc.total += next.total;
    acc.active += next.active;
    acc.completed += next.completed;
    return acc;
  }, { total: 0, active: 0, completed: 0 });
}

function countActiveDays(itemsByDay) {
  return Object.keys(itemsByDay || {}).length;
}

function countOpenDeadlinesInRange(items = [], start, end) {
  return items.reduce((count, item) => {
    if (!item?.due_date || item.status === "complete") return count;
    const due = new Date(`${item.due_date}T00:00:00`);
    if (Number.isNaN(due.getTime())) return count;
    if (due < start || due > end) return count;
    return count + 1;
  }, 0);
}

function getOverviewModel({
  view,
  viewYear,
  viewMonth,
  currentYear,
  currentMonth,
  todayDate,
  itemsByDay,
  computed,
  data,
}) {
  const meta = getCalendarViewMeta(view);
  const monthLabel = formatMonthLabel(viewYear, viewMonth);
  const activeDays = countActiveDays(itemsByDay);
  const month = summarizeMonth(itemsByDay);

  if (view === "events") {
    const totalEvents = computed?.totalEvents || 0;
    const allDayEvents = computed?.allDayEvents || 0;

    return {
      ...meta,
      eyebrow: "Month overview",
      title: monthLabel,
      description: totalEvents
        ? `${activeDays} active day${activeDays === 1 ? "" : "s"} spread across the month. Select a day to inspect timing, attendees, and links.`
        : `No events are scheduled in ${monthLabel} yet. Select a day to inspect a clean block or add something new.`,
      spotlight: {
        label: "Events this month",
        value: `${totalEvents}`,
        detail: allDayEvents
          ? `${allDayEvents} all-day item${allDayEvents === 1 ? "" : "s"}`
          : "No all-day holds",
      },
      stats: [
        {
          label: "Active days",
          value: `${activeDays}`,
          detail: totalEvents ? "Days carrying calendar load" : "Month is still open",
        },
        {
          label: "All-day",
          value: `${allDayEvents}`,
          detail: allDayEvents ? "Long blocks on the calendar" : "Nothing spans the whole day",
        },
      ],
      footerLabel: "Month detail",
    };
  }

  if (view === "bills") {
    const monthTotal = computed?.monthTotal || 0;

    return {
      ...meta,
      eyebrow: "Month overview",
      title: monthLabel,
      description: month.total
        ? `${month.active} unpaid and ${month.completed} paid bill${month.total === 1 ? "" : "s"} are scheduled this month. Select a day to inspect the stack.`
        : `No scheduled bills land in ${monthLabel} yet. Select a day to inspect the empty rhythm or review the month total.`,
      spotlight: {
        label: "Scheduled this month",
        value: currencyFormatter.format(monthTotal),
        detail: month.total
          ? `${activeDays} billing day${activeDays === 1 ? "" : "s"} on the grid`
          : "Nothing is on the books yet",
      },
      stats: [
        {
          label: "Unpaid",
          value: `${month.active}`,
          detail: month.active ? "Still waiting to be cleared" : "Nothing outstanding",
        },
        {
          label: "Paid",
          value: `${month.completed}`,
          detail: month.completed ? "Already cleared this month" : "No paid items landed here",
        },
      ],
      footerLabel: "Budget detail",
    };
  }

  const isCurrentMonth = viewYear === currentYear && viewMonth === currentMonth;
  const openItems = month.active;
  const allDeadlineItems = [
    ...(data?.ctm?.upcoming || []),
    ...(data?.todoist?.upcoming || []),
  ];
  const today = new Date(currentYear, currentMonth, todayDate);
  today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const dueToday = isCurrentMonth
    ? countOpenDeadlinesInRange(allDeadlineItems, today, today)
    : null;
  const dueThisWeek = isCurrentMonth
    ? countOpenDeadlinesInRange(allDeadlineItems, weekStart, weekEnd)
    : null;

  return {
    ...meta,
    eyebrow: "Month overview",
    title: monthLabel,
    description: month.total
      ? `${openItems} open and ${month.completed} complete deadlines are distributed across ${activeDays} day${activeDays === 1 ? "" : "s"}. Select a day to review or edit tasks.`
      : `Nothing is due in ${monthLabel} yet. Select a day to keep the month overview visible while you plan.`,
    spotlight: {
      label: "Open this month",
      value: `${openItems}`,
      detail: month.total
        ? `${month.total} total deadline${month.total === 1 ? "" : "s"} tracked`
        : "The month is currently clear",
    },
    stats: [
      {
        label: isCurrentMonth ? "Due today" : "Active days",
        value: `${isCurrentMonth ? dueToday : activeDays}`,
        detail: isCurrentMonth
          ? dueToday ? "Open items due today" : "Nothing due today"
          : activeDays ? "Days with deadline activity" : "No active days yet",
      },
      {
        label: isCurrentMonth ? "Due this week" : "Complete",
        value: `${isCurrentMonth ? dueThisWeek : month.completed}`,
        detail: isCurrentMonth
          ? dueThisWeek ? "Open items inside this week" : "Week is clear"
          : month.completed ? "Already cleared this month" : "Nothing complete yet",
      },
    ],
    footerLabel: "Coursework detail",
  };
}

function railStaticStyle() {
  return {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  };
}

function railContentStyle({ compact = false } = {}) {
  return {
    boxSizing: "border-box",
    padding: compact ? "18px 20px" : "20px 22px",
    display: "flex",
    flexDirection: "column",
    gap: compact ? 12 : 14,
    minHeight: "100%",
  };
}

function heroCardStyle(accent) {
  return {
    position: "relative",
    overflow: "hidden",
    borderRadius: 16,
    border: `1px solid color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.05))`,
    background: `radial-gradient(circle at top left, color-mix(in srgb, ${accent} 18%, transparent), transparent 42%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    flexShrink: 0,
  };
}

function OverviewHero({ model, compact = false }) {
  const Icon = model.icon;

  return (
    <div style={heroCardStyle(model.accent)}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 0.8px, transparent 0.8px)",
          backgroundSize: "20px 20px",
          opacity: 0.18,
          maskImage: "linear-gradient(180deg, rgba(0,0,0,0.9), rgba(0,0,0,0.3))",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: compact ? "16px 16px 14px" : "18px 18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: compact ? 10 : 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2.4,
              textTransform: "uppercase",
              color: "rgba(205,214,244,0.52)",
            }}
          >
            {model.eyebrow}
          </div>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              display: "grid",
              placeItems: "center",
              background: `color-mix(in srgb, ${model.accent} 14%, rgba(255,255,255,0.03))`,
              border: `1px solid color-mix(in srgb, ${model.accent} 20%, rgba(255,255,255,0.04))`,
              color: model.accent,
              boxShadow: `0 0 14px color-mix(in srgb, ${model.accent} 14%, transparent)`,
            }}
          >
            <Icon size={15} strokeWidth={1.9} />
          </div>
        </div>

        <div
          className="ea-display"
          style={{
            fontSize: compact ? 22 : 24,
            lineHeight: 1.02,
            letterSpacing: compact ? -0.38 : -0.45,
            color: "#f5f7ff",
          }}
        >
          {model.title}
        </div>

        <div style={{ fontSize: 12.5, lineHeight: compact ? 1.54 : 1.62, color: "rgba(205,214,244,0.62)" }}>
          {model.description}
        </div>
      </div>
    </div>
  );
}

function SpotlightCard({ accent, label, value, detail, compact = false }) {
  return (
    <div
      style={{
        gridColumn: "1 / -1",
        padding: compact ? "14px 14px 12px" : "16px 16px 14px",
        borderRadius: 14,
        background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 9%, rgba(255,255,255,0.025)), rgba(255,255,255,0.02))`,
        border: `1px solid color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.05))`,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.48)" }}>
        {label}
      </div>
      <div
        className="ea-display"
        style={{
          marginTop: 8,
          fontSize: compact ? 24 : 28,
          lineHeight: 1,
          letterSpacing: compact ? -0.42 : -0.55,
          color: "#fff",
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: compact ? 1.48 : 1.55, color: "rgba(205,214,244,0.56)" }}>
        {detail}
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail, accent, compact = false }) {
  return (
    <div
      style={{
        padding: compact ? "11px 12px 10px" : "13px 14px 12px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.018)",
        border: "1px solid rgba(255,255,255,0.05)",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.6, textTransform: "uppercase", color: "rgba(205,214,244,0.44)" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: compact ? 7 : 8,
          fontSize: compact ? 18 : 20,
          fontWeight: 500,
          lineHeight: 1,
          color: accent,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: compact ? 7 : 8, fontSize: 11, lineHeight: compact ? 1.42 : 1.5, color: "rgba(205,214,244,0.48)" }}>
        {detail}
      </div>
    </div>
  );
}

function FooterFrame({ label, children }) {
  if (!children) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 1.9, textTransform: "uppercase", color: "rgba(205,214,244,0.4)" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function EventsLoadingFrame() {
  return (
    <div
      data-testid="calendar-events-rail-skeleton"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
        borderRadius: 14,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.05)",
        flexShrink: 0,
      }}
    >
      <Skeleton className="h-[11px] w-[128px] bg-white/8" />
      <Skeleton className="h-[22px] w-[212px] bg-white/10" />
      <Skeleton className="h-[12px] w-full bg-white/7" />
      <Skeleton className="h-[12px] w-[88%] bg-white/7" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 4 }}>
        <Skeleton className="h-[92px] w-full rounded-[12px] bg-white/7" />
        <Skeleton className="h-[92px] w-full rounded-[12px] bg-white/7" />
      </div>
    </div>
  );
}

function EmptyDayCard({ model, viewYear, viewMonth, selectedDay }) {
  const Icon = model.icon;

  return (
    <div
      data-testid="calendar-selected-empty-rail"
      style={{
        ...heroCardStyle(model.accent),
        padding: 14,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 0.8px, transparent 0.8px)",
          backgroundSize: "20px 20px",
          opacity: 0.16,
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                flexShrink: 0,
                background: model.accent,
                boxShadow: `0 0 8px color-mix(in srgb, ${model.accent} 34%, transparent)`,
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.2, textTransform: "uppercase", color: "rgba(205,214,244,0.48)" }}>
                {model.selectedDayLabel}
              </div>
              <div style={{ fontSize: 11, lineHeight: 1.25, color: "rgba(205,214,244,0.58)" }}>
                {model.emptyDayLabel}
              </div>
            </div>
          </div>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              background: `color-mix(in srgb, ${model.accent} 14%, rgba(255,255,255,0.03))`,
              border: `1px solid color-mix(in srgb, ${model.accent} 20%, rgba(255,255,255,0.04))`,
              color: model.accent,
            }}
          >
            <Icon size={15} strokeWidth={1.9} />
          </div>
        </div>

        <div className="ea-display" style={{ fontSize: 21, lineHeight: 1.04, letterSpacing: -0.34, color: "#fff" }}>
          {formatFullDate(viewYear, viewMonth, selectedDay)}
        </div>

        <div style={{ maxWidth: 260, fontSize: 12, lineHeight: 1.46, color: "rgba(205,214,244,0.62)" }}>
          {model.railDescription}
        </div>
      </div>
    </div>
  );
}

function formatNeighborDate(year, month, day) {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function neighborActiveCount(activeView, items) {
  if (activeView?.getDayState) {
    const state = activeView.getDayState(items);
    return {
      active: state.activeCount || 0,
      total: state.totalCount || 0,
    };
  }
  const list = Array.isArray(items) ? items : [];
  return { active: list.length, total: list.length };
}

function findNeighborDays(itemsByDay, selectedDay) {
  const days = Object.keys(itemsByDay || {})
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  let prev = null;
  let next = null;
  for (const day of days) {
    if (day < selectedDay) prev = day;
    else if (day > selectedDay && next === null) next = day;
  }
  return { prev, next };
}

function NeighborRow({
  direction,
  label,
  day,
  items,
  activeView,
  noun,
  accent,
  viewYear,
  viewMonth,
  onSelectDay,
}) {
  const hasDay = Number.isFinite(day);
  const Icon = direction === "prev" ? ArrowLeft : ArrowRight;
  const dateLabel = hasDay ? formatNeighborDate(viewYear, viewMonth, day) : null;
  const { active } = hasDay
    ? neighborActiveCount(activeView, items)
    : { active: 0 };
  const countLabel = hasDay
    ? `${active} ${active === 1 ? noun : `${noun}s`}`
    : null;

  return (
    <button
      type="button"
      data-testid={`calendar-empty-rail-neighbor-${direction}`}
      disabled={!hasDay}
      onClick={hasDay ? () => onSelectDay?.(day) : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "10px 12px",
        borderRadius: 9,
        border: hasDay
          ? `1px solid color-mix(in srgb, ${accent} 14%, rgba(255,255,255,0.05))`
          : "1px dashed rgba(255,255,255,0.06)",
        background: hasDay
          ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 6%, rgba(255,255,255,0.02)), rgba(255,255,255,0.012))`
          : "rgba(255,255,255,0.012)",
        cursor: hasDay ? "pointer" : "default",
        opacity: hasDay ? 1 : 0.6,
        fontFamily: "inherit",
        textAlign: "left",
        transition: "background 140ms, border-color 140ms, transform 140ms",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          color: hasDay ? accent : "rgba(205,214,244,0.4)",
          background: hasDay
            ? `color-mix(in srgb, ${accent} 14%, rgba(255,255,255,0.02))`
            : "rgba(255,255,255,0.02)",
          border: hasDay
            ? `1px solid color-mix(in srgb, ${accent} 22%, rgba(255,255,255,0.05))`
            : "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <Icon size={13} strokeWidth={2} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: 1.6,
            textTransform: "uppercase",
            color: "rgba(205,214,244,0.48)",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: hasDay ? "#eef2ff" : "rgba(205,214,244,0.55)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {hasDay ? dateLabel : `Nothing ${label.toLowerCase()}`}
        </div>
      </div>
      {countLabel ? (
        <div
          style={{
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(205,214,244,0.66)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {countLabel}
        </div>
      ) : null}
    </button>
  );
}

function NearbyActivityCard({
  model,
  activeView,
  itemsByDay,
  selectedDay,
  viewYear,
  viewMonth,
  onSelectDay,
}) {
  const { prev, next } = findNeighborDays(itemsByDay, selectedDay);
  const noun = model.itemNoun || "item";
  const isClearMonth = prev === null && next === null;

  return (
    <div
      data-testid="calendar-empty-rail-neighbors"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "rgba(205,214,244,0.42)",
        }}
      >
        Nearby activity
      </div>
      <NeighborRow
        direction="prev"
        label="Earlier"
        day={prev}
        items={prev ? itemsByDay[prev] : null}
        activeView={activeView}
        noun={noun}
        accent={model.accent}
        viewYear={viewYear}
        viewMonth={viewMonth}
        onSelectDay={onSelectDay}
      />
      <NeighborRow
        direction="next"
        label="Later"
        day={next}
        items={next ? itemsByDay[next] : null}
        activeView={activeView}
        noun={noun}
        accent={model.accent}
        viewYear={viewYear}
        viewMonth={viewMonth}
        onSelectDay={onSelectDay}
      />
      {isClearMonth ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px dashed rgba(255,255,255,0.06)",
            fontSize: 11,
            lineHeight: 1.55,
            color: "rgba(205,214,244,0.52)",
          }}
        >
          The month is clear in both directions. Use ←/→ or click any day to browse.
        </div>
      ) : null}
    </div>
  );
}

export function CalendarOverviewRail(props) {
  const model = getOverviewModel(props);
  const footer = props.activeView.renderFooter?.(props);

  return (
    <div data-testid="calendar-overview-rail-frame" style={railStaticStyle()}>
      <div style={{ ...railContentStyle({ compact: true }), justifyContent: "space-between" }}>
        <OverviewHero model={model} compact />

        {props.view === "events" && props.data?.isLoading ? (
          <EventsLoadingFrame />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, flexShrink: 0 }}>
            <SpotlightCard {...model.spotlight} accent={model.accent} compact />
            {model.stats.map((stat) => (
              <MetricCard
                key={stat.label}
                {...stat}
                accent={model.accent}
                compact
              />
            ))}
          </div>
        )}

        <div
          style={{
            padding: "9px 11px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.05)",
            background: "rgba(255,255,255,0.018)",
            fontSize: 11,
            lineHeight: 1.48,
            color: "rgba(205,214,244,0.56)",
            flexShrink: 0,
          }}
        >
          Select any day to drill into the rail without losing the month context.
        </div>

        <div style={{ marginTop: "auto" }}>
          <FooterFrame label={model.footerLabel}>{footer}</FooterFrame>
        </div>
      </div>
    </div>
  );
}

export function CalendarSelectedDayEmptyRail(props) {
  const model = getCalendarViewMeta(props.view);
  const overview = getOverviewModel(props);
  const footer = props.activeView.renderFooter?.(props);
  const handleSelectDay = (day) => {
    props.setDeadlineEditor?.(null);
    props.setSelectedItemId?.(null);
    props.setSelectedDay?.(day);
  };

  return (
    <div data-testid="calendar-selected-empty-rail-frame" style={railStaticStyle()}>
      <div style={{ ...railContentStyle({ compact: true }), justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
          <EmptyDayCard
            model={model}
            viewYear={props.viewYear}
            viewMonth={props.viewMonth}
            selectedDay={props.selectedDay}
          />

          <NearbyActivityCard
            model={model}
            activeView={props.activeView}
            itemsByDay={props.itemsByDay}
            selectedDay={props.selectedDay}
            viewYear={props.viewYear}
            viewMonth={props.viewMonth}
            onSelectDay={handleSelectDay}
          />
        </div>

        <div style={{ marginTop: "auto" }}>
          <FooterFrame label={overview.footerLabel}>{footer}</FooterFrame>
        </div>
      </div>
    </div>
  );
}
