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

export function formatFullDate(viewYear, viewMonth, day) {
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

export function getOverviewModel({
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

function selectedDateYmd(viewYear, viewMonth, selectedDay, selectedDateKey) {
  if (selectedDateKey) return selectedDateKey;
  if (!selectedDay) return null;
  return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

function formatShortDate(viewYear, viewMonth, selectedDay, selectedDateKey) {
  const parsed = parseDateKey(selectedDateKey);
  if (!selectedDay && !parsed) return null;
  return new Date(parsed?.year ?? viewYear, parsed?.month ?? viewMonth, parsed?.day ?? selectedDay).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function emptyDayPrimaryAction(props) {
  const dateLabel = formatShortDate(props.viewYear, props.viewMonth, props.selectedDay, props.selectedDateKey);
  const seedDate = selectedDateYmd(props.viewYear, props.viewMonth, props.selectedDay, props.selectedDateKey);

  if (props.view === "events" && props.eventEditor?.editable && props.onCreateEvent) {
    return {
      label: dateLabel ? `Create on ${dateLabel}` : "Create event",
      detail: "Create directly on the selected date.",
      onClick: props.onCreateEvent,
    };
  }

  if (props.view === "deadlines" && props.onCreateTask) {
    return {
      label: dateLabel ? `Create task due ${dateLabel}` : "Create task",
      detail: "Seed Todoist with this due date.",
      onClick: () => props.onCreateTask(seedDate),
    };
  }

  return null;
}

export function formatNeighborDate(year, month, day) {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function neighborActiveCount(activeView, items) {
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

export function findNeighborDays(itemsByDay, selectedDay) {
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
