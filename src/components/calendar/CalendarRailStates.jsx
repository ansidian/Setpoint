import { Calendar as CalendarIcon, ListChecks, Receipt } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const VIEW_META = {
  events: {
    label: "Events",
    icon: CalendarIcon,
    accent: "#89b4fa",
    emptyDayLabel: "No events",
  },
  bills: {
    label: "Bills",
    icon: Receipt,
    accent: "#a6e3a1",
    emptyDayLabel: "No bills",
  },
  deadlines: {
    label: "Deadlines",
    icon: ListChecks,
    accent: "var(--ea-accent)",
    emptyDayLabel: "No deadlines",
  },
};

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
  const meta = VIEW_META[view];
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

function getEmptyDayDescription(view, monthLabel) {
  if (view === "events") {
    return `No events are scheduled on this date. The rest of ${monthLabel} still stays visible below.`;
  }
  if (view === "bills") {
    return `No scheduled bills land on this date. The broader month snapshot stays available below.`;
  }
  return `No deadlines are due on this date. The broader month snapshot stays available below.`;
}

function railShellStyle() {
  return {
    flex: 1,
    padding: "20px 22px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
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
  };
}

function OverviewHero({ model }) {
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
          padding: "18px 18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
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

        <div className="ea-display" style={{ fontSize: 24, lineHeight: 1.02, letterSpacing: -0.45, color: "#f5f7ff" }}>
          {model.title}
        </div>

        <div style={{ fontSize: 12.5, lineHeight: 1.62, color: "rgba(205,214,244,0.62)" }}>
          {model.description}
        </div>
      </div>
    </div>
  );
}

function SpotlightCard({ accent, label, value, detail }) {
  return (
    <div
      style={{
        gridColumn: "1 / -1",
        padding: "16px 16px 14px",
        borderRadius: 14,
        background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 9%, rgba(255,255,255,0.025)), rgba(255,255,255,0.02))`,
        border: `1px solid color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.05))`,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.48)" }}>
        {label}
      </div>
      <div className="ea-display" style={{ marginTop: 8, fontSize: 28, lineHeight: 1, letterSpacing: -0.55, color: "#fff" }}>
        {value}
      </div>
      <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.55, color: "rgba(205,214,244,0.56)" }}>
        {detail}
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail, accent }) {
  return (
    <div
      style={{
        padding: "13px 14px 12px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.018)",
        border: "1px solid rgba(255,255,255,0.05)",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.6, textTransform: "uppercase", color: "rgba(205,214,244,0.44)" }}>
        {label}
      </div>
      <div style={{ marginTop: 8, fontSize: 20, fontWeight: 500, lineHeight: 1, color: accent, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5, color: "rgba(205,214,244,0.48)" }}>
        {detail}
      </div>
    </div>
  );
}

function FooterFrame({ label, children }) {
  if (!children) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: "rgba(205,214,244,0.4)" }}>
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

function EmptyDayHero({ model, viewYear, viewMonth, selectedDay }) {
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
          opacity: 0.16,
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "18px 18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.4, textTransform: "uppercase", color: "rgba(205,214,244,0.48)" }}>
              {model.label} open day
            </div>
            <div style={{ fontSize: 11.5, color: "rgba(205,214,244,0.62)" }}>
              {model.emptyDayLabel}
            </div>
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
            }}
          >
            <Icon size={15} strokeWidth={1.9} />
          </div>
        </div>

        <div className="ea-display" style={{ fontSize: 24, lineHeight: 1.08, letterSpacing: -0.42, color: "#fff" }}>
          {formatFullDate(viewYear, viewMonth, selectedDay)}
        </div>

        <div style={{ fontSize: 12.5, lineHeight: 1.62, color: "rgba(205,214,244,0.62)" }}>
          {getEmptyDayDescription(model.key, formatMonthLabel(viewYear, viewMonth))}
        </div>
      </div>
    </div>
  );
}

export function CalendarOverviewRail(props) {
  const model = getOverviewModel(props);
  const footer = props.activeView.renderFooter?.(props);

  return (
    <div style={railShellStyle()}>
      <OverviewHero model={model} />

      {props.view === "events" && props.data?.isLoading ? (
        <EventsLoadingFrame />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <SpotlightCard {...model.spotlight} accent={model.accent} />
          {model.stats.map((stat) => (
            <MetricCard
              key={stat.label}
              {...stat}
              accent={model.accent}
            />
          ))}
        </div>
      )}

      <div
        style={{
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(255,255,255,0.018)",
          fontSize: 11.5,
          lineHeight: 1.55,
          color: "rgba(205,214,244,0.56)",
        }}
      >
        Select any day to drill into the rail without losing the month context.
      </div>

      <div style={{ marginTop: "auto" }}>
        <FooterFrame label={model.footerLabel}>{footer}</FooterFrame>
      </div>
    </div>
  );
}

export function CalendarSelectedDayEmptyRail(props) {
  const model = {
    ...VIEW_META[props.view],
    key: props.view,
  };
  const overview = getOverviewModel(props);
  const footer = props.activeView.renderFooter?.(props);

  return (
    <div style={railShellStyle()}>
      <EmptyDayHero
        model={model}
        viewYear={props.viewYear}
        viewMonth={props.viewMonth}
        selectedDay={props.selectedDay}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        <SpotlightCard
          accent={overview.accent}
          label="Selected day"
          value="0"
          detail={`${overview.emptyDayLabel || model.emptyDayLabel} land here.`}
        />
        {overview.stats.map((stat) => (
          <MetricCard
            key={stat.label}
            {...stat}
            accent={overview.accent}
          />
        ))}
      </div>

      <div
        style={{
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(255,255,255,0.018)",
          fontSize: 11.5,
          lineHeight: 1.55,
          color: "rgba(205,214,244,0.56)",
        }}
      >
        Pick another day to inspect items, or keep this open as a clean spacer in the month.
      </div>

      <div style={{ marginTop: "auto" }}>
        <FooterFrame label={overview.footerLabel}>{footer}</FooterFrame>
      </div>
    </div>
  );
}
