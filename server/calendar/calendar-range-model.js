const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 62;

export function addMonthsIso(isoDate, months) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const targetMonth = month - 1 + months;
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, targetMonth, Math.min(day, lastDay)));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
}

function pacificDate(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(now);
}

export function validateCalendarRange({ start, end } = {}, {
  enforceHistoryWindow = false,
  now = new Date(),
} = {}) {
  if (!start) {
    return {
      ok: false,
      message: "start param required (YYYY-MM-DD)",
    };
  }
  if (!end) {
    return {
      ok: false,
      message: "end param required (YYYY-MM-DD)",
    };
  }
  if (!ISO_DATE_RE.test(start) || !ISO_DATE_RE.test(end)) {
    return {
      ok: false,
      message: "start/end must be YYYY-MM-DD",
    };
  }

  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return {
      ok: false,
      message: "invalid date value",
    };
  }
  if (endDate < startDate) {
    return {
      ok: false,
      message: "end must be >= start",
    };
  }
  const spanDays = Math.round((endDate - startDate) / 86400000);
  if (spanDays > MAX_SPAN_DAYS) {
    return {
      ok: false,
      message: `span must be <= ${MAX_SPAN_DAYS} days`,
    };
  }

  if (enforceHistoryWindow) {
    const minDate = addMonthsIso(pacificDate(now), -12);
    if (end < minDate) {
      return {
        ok: false,
        message: "range must overlap the rolling 12-month calendar window",
      };
    }
    return {
      ok: true,
      value: { start, end, startDate, endDate, minDate },
    };
  }

  return { ok: true, value: { start, end, startDate, endDate } };
}
