import { formatRecurrenceSummary } from "../../calendar/events/calendarEditorUtils";
import { parseCalendarTitle } from "../../calendar/events/parseCalendarTitle";

const PRIORITY_RE = /(?:^|\s)(!([1-4])?)(?:\s|$)/;
const PROJECT_RE = /#(\w+)/g;
const LABEL_RE = /@(\w+)/g;

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
const TODOIST_WEEKDAY_BY_CODE = {
  SU: "sun",
  MO: "mon",
  TU: "tue",
  WE: "wed",
  TH: "thu",
  FR: "fri",
  SA: "sat",
};

const DATE_TIME_PATTERNS = [
  { re: /\b(today|tonight|tomorrow)(?:\s+at)?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i, type: "relative_time" },
  { re: /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))(?:\s+)(today|tonight|tomorrow)\b/i, type: "time_relative" },
  { re: /\b(next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))(?:\s+at)?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i, type: "next_day_time" },
  { re: /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+(next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i, type: "time_next_day" },
  { re: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at)?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i, type: "day_time" },
  { re: /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, type: "time_day" },
  { re: /\b(today)\b/i, type: "today" },
  { re: /\b(tonight)\b/i, type: "tonight" },
  { re: /\b(tomorrow)\b/i, type: "tomorrow" },
  { re: /\b(next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i, type: "next_day" },
  { re: /\b(next\s+week)\b/i, type: "next_week" },
  { re: /\b(this\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i, type: "this_day" },
  { re: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, type: "day" },
  { re: /\b(in\s+\d+\s+(?:days?|weeks?|months?))\b/i, type: "in_duration" },
  { re: /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(?:\s*,?\s*\d{4})?)(?:\s+at)?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i, type: "month_day_time" },
  { re: /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(?:\s*,?\s*\d{4})?)\b/i, type: "time_month_day" },
  { re: /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(?:\s*,?\s*\d{4})?)\b/i, type: "month_day" },
  { re: /\b(\d{4}-\d{2}-\d{2})\b/, type: "iso" },
  { re: /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i, type: "bare_time" },
];

function parseTime(timeStr) {
  const match = timeStr.match(TIME_RE);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3].toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function formatTime(time) {
  if (!time) return "";
  let hour = time.hour;
  const ampm = hour >= 12 ? "PM" : "AM";
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;
  return time.minute ? `${hour}:${String(time.minute).padStart(2, "0")} ${ampm}` : `${hour} ${ampm}`;
}

function formatDraftTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";
  return formatTime({ hour: Number(match[1]), minute: Number(match[2]) });
}

function formatTodoistTime(value) {
  return formatDraftTime(value).replace(/\s/g, "").toLowerCase();
}

function buildRecurringDisplay(recurrenceDraft, includeTime = false) {
  const summary = formatRecurrenceSummary(recurrenceDraft, recurrenceDraft?.startDate);
  const time = includeTime ? formatDraftTime(recurrenceDraft?.startTime) : "";
  return [summary, time ? `at ${time}` : ""].filter(Boolean).join(" ");
}

function formatTodoistWeekdays(weekdays) {
  const codes = Array.isArray(weekdays) ? weekdays : [];
  if (codes.join(",") === "MO,TU,WE,TH,FR") return "weekday";
  if (codes.join(",") === "SA,SU") return "weekend";
  return codes.map((code) => TODOIST_WEEKDAY_BY_CODE[code]).filter(Boolean).join(", ");
}

function buildTodoistRecurringDueString(recurrenceDraft, includeTime = false) {
  if (!recurrenceDraft?.frequency) return null;
  const interval = Math.max(1, Number(recurrenceDraft.interval) || 1);
  let dueString = null;

  if (recurrenceDraft.frequency === "daily") {
    dueString = interval > 1 ? `every ${interval} days` : "every day";
  } else if (recurrenceDraft.frequency === "weekly") {
    const weekdayList = formatTodoistWeekdays(recurrenceDraft.weekdays);
    if (interval === 1) {
      dueString = weekdayList ? `every ${weekdayList}` : "every week";
    } else {
      dueString = `every ${interval} weeks`;
    }
  } else if (recurrenceDraft.frequency === "monthly") {
    dueString = interval > 1 ? `every ${interval} months` : "every month";
  } else if (recurrenceDraft.frequency === "yearly") {
    dueString = interval > 1 ? `every ${interval} years` : "every year";
  }

  const time = includeTime ? formatTodoistTime(recurrenceDraft.startTime) : "";
  return [dueString, time ? `at ${time}` : ""].filter(Boolean).join(" ") || null;
}

function parseRecurringDue(input) {
  const parsed = parseCalendarTitle(input, {
    defaultStartTime: null,
    defaultEndTime: null,
  });

  if (parsed.mode !== "recurring" || !parsed.recurrenceDraft) return null;

  const hasExplicitTime = !!parsed.parsedDateTime?.hasTime;
  const dueString = buildTodoistRecurringDueString(parsed.recurrenceDraft, hasExplicitTime)
    || parsed.matchedText
    || input.replace(parsed.cleanTitle, "").trim();
  if (!dueString) return null;

  return {
    cleanTitle: parsed.cleanTitle.replace(/\s+\b(?:at|by|on|from|to)\b$/i, "").trim(),
    dueString,
    recurrenceDraft: parsed.recurrenceDraft,
    recurrenceSummary: buildRecurringDisplay(parsed.recurrenceDraft, hasExplicitTime),
  };
}

function getNextDayOfWeek(dayName, fromDate) {
  const target = DAYS.indexOf(dayName.toLowerCase());
  if (target < 0) return fromDate;
  const date = new Date(fromDate);
  const current = date.getDay();
  let diff = target - current;
  if (diff <= 0) diff += 7;
  date.setDate(date.getDate() + diff);
  return date;
}

function resolveDate(input) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const { re, type } of DATE_TIME_PATTERNS) {
    const match = input.match(re);
    if (!match) continue;

    let date = null;
    let time = null;
    const phrase = match[0];

    switch (type) {
      case "relative_time": {
        const word = match[1].toLowerCase();
        date = word === "tomorrow" ? new Date(today.getTime() + 86400000) : new Date(today);
        time = parseTime(match[2]);
        if (word === "tonight" && !time) time = { hour: 21, minute: 0 };
        break;
      }
      case "time_relative": {
        const word = match[2].toLowerCase();
        date = word === "tomorrow" ? new Date(today.getTime() + 86400000) : new Date(today);
        time = parseTime(match[1]);
        if (word === "tonight" && !time) time = { hour: 21, minute: 0 };
        break;
      }
      case "next_day_time": {
        date = getNextDayOfWeek(match[1].replace(/^next\s+/i, ""), today);
        time = parseTime(match[2]);
        break;
      }
      case "time_next_day": {
        date = getNextDayOfWeek(match[2].replace(/^next\s+/i, ""), today);
        time = parseTime(match[1]);
        break;
      }
      case "day_time":
        date = getNextDayOfWeek(match[1], today);
        time = parseTime(match[2]);
        break;
      case "time_day":
        date = getNextDayOfWeek(match[2], today);
        time = parseTime(match[1]);
        break;
      case "today":
        date = new Date(today);
        break;
      case "tonight":
        date = new Date(today);
        time = { hour: 21, minute: 0 };
        break;
      case "tomorrow":
        date = new Date(today.getTime() + 86400000);
        break;
      case "next_day":
        date = getNextDayOfWeek(match[1].replace(/^next\s+/i, ""), today);
        break;
      case "next_week":
        date = new Date(today.getTime() + 7 * 86400000);
        break;
      case "this_day":
        date = getNextDayOfWeek(match[1].replace(/^this\s+/i, ""), today);
        break;
      case "day":
        date = getNextDayOfWeek(match[1], today);
        break;
      case "in_duration": {
        const durationMatch = match[1].match(/in\s+(\d+)\s+(days?|weeks?|months?)/i);
        if (durationMatch) {
          const count = parseInt(durationMatch[1], 10);
          const unit = durationMatch[2].toLowerCase().replace(/s$/, "");
          date = new Date(today);
          if (unit === "day") date.setDate(date.getDate() + count);
          else if (unit === "week") date.setDate(date.getDate() + count * 7);
          else if (unit === "month") date.setMonth(date.getMonth() + count);
        }
        break;
      }
      case "month_day":
      case "month_day_time":
      case "time_month_day": {
        const dateGroup = type === "time_month_day" ? match[2] : match[1];
        const timeGroup = type === "month_day_time" ? match[2] : type === "time_month_day" ? match[1] : null;
        const parts = dateGroup.match(/(\w+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
        if (parts) {
          const monthIdx = MONTHS_LONG.findIndex((month) => month.startsWith(parts[1].toLowerCase()));
          if (monthIdx >= 0) {
            const year = parts[3] ? parseInt(parts[3], 10) : now.getFullYear();
            date = new Date(year, monthIdx, parseInt(parts[2], 10));
            if (!parts[3] && date < today) date.setFullYear(date.getFullYear() + 1);
          }
        }
        if (timeGroup) time = parseTime(timeGroup);
        break;
      }
      case "iso": {
        const [year, month, day] = match[1].split("-").map(Number);
        date = new Date(year, month - 1, day);
        break;
      }
      case "bare_time":
        date = new Date(today);
        time = parseTime(match[1]);
        break;
    }

    if (!date) continue;
    return { date, time, phrase };
  }

  return null;
}

export function formatResolvedDate(resolved) {
  if (!resolved) return null;
  const { date, time } = resolved;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);

  let prefix;
  if (date.getTime() === today.getTime()) prefix = "Today";
  else if (date.getTime() === tomorrow.getTime()) prefix = "Tomorrow";
  else prefix = DAYS[date.getDay()].charAt(0).toUpperCase() + DAYS[date.getDay()].slice(1);

  const monthDay = `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
  const year = date.getFullYear() !== now.getFullYear() ? `, ${date.getFullYear()}` : "";
  const timeStr = time ? ` at ${formatTime(time)}` : "";
  return `${prefix}, ${monthDay}${year}${timeStr}`;
}

export function parseTokens(input, projects, labels) {
  const result = {
    priority: null,
    project: null,
    labels: [],
    datePhrase: null,
    dateFormatted: null,
    recurrenceDraft: null,
    recurrenceSummary: null,
    recurringDueString: null,
    stripped: input,
  };

  const priorityMatch = input.match(PRIORITY_RE);
  if (priorityMatch) {
    result.priority = priorityMatch[2] ? parseInt(priorityMatch[2], 10) : 1;
    result.stripped = result.stripped.replace(
      priorityMatch[0],
      priorityMatch[0].startsWith(" ") ? " " : "",
    );
  }

  for (const match of input.matchAll(PROJECT_RE)) {
    const token = match[1].toLowerCase();
    const project = projects.find((entry) => entry.name.toLowerCase().startsWith(token));
    if (project) {
      result.project = project;
      result.stripped = result.stripped.replace(match[0], "");
    }
  }

  for (const match of input.matchAll(LABEL_RE)) {
    const token = match[1].toLowerCase();
    const label = labels.find((entry) => entry.name.toLowerCase() === token);
    if (label && !result.labels.find((entry) => entry.id === label.id)) {
      result.labels.push(label);
      result.stripped = result.stripped.replace(match[0], "");
    }
  }

  const recurring = parseRecurringDue(result.stripped);
  if (recurring) {
    result.recurringDueString = recurring.dueString;
    result.recurrenceDraft = recurring.recurrenceDraft;
    result.recurrenceSummary = recurring.recurrenceSummary;
    result.dateFormatted = recurring.recurrenceSummary;
    result.stripped = recurring.cleanTitle || result.stripped.replace(recurring.dueString, "");
    result.stripped = result.stripped.replace(/\s{2,}/g, " ").trim();
    return result;
  }

  const resolved = resolveDate(result.stripped);
  if (resolved) {
    result.datePhrase = resolved.phrase;
    result.dateFormatted = formatResolvedDate(resolved);
    result.stripped = result.stripped.replace(resolved.phrase, "");
  }

  result.stripped = result.stripped.replace(/\s{2,}/g, " ").trim();
  return result;
}
