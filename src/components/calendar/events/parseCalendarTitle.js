import * as chrono from "chrono-node/en";
import { epochFromLa, laComponents } from "@/components/inbox/helpers";
import { parseCalendarIntent } from "./calendarTitleIntent";

const DEFAULT_DURATION_MINUTES = 30;
const TRAILING_CONNECTOR_RE = /(?:\s+(?:on|at|from|to|for))+\s*$/i;
const TIME_LIKE_TOKEN_RE = /^\d{1,2}(?::\d{0,2})?\s*(?:a|p|am|pm)?$/i;
const DATE_LIKE_TOKEN_RE = /^(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{1,2}-\d{1,2})$/i;
const TEMPORAL_START_WORDS = new Set([
  "at",
  "on",
  "from",
  "to",
  "today",
  "tomorrow",
  "tonight",
  "tmr",
  "tmrw",
  "mon",
  "monday",
  "tue",
  "tues",
  "tuesday",
  "wed",
  "wednesday",
  "thu",
  "thur",
  "thurs",
  "thursday",
  "fri",
  "friday",
  "sat",
  "saturday",
  "sun",
  "sunday",
  "next",
  "this",
]);

function cleanWhitespace(value) {
  return String(value || "").replace(/\s{2,}/g, " ").trim();
}

function timePartsFromString(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function minutesToTime(minutes) {
  const clamped = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function plusMinutes(dateStr, timeStr, deltaMinutes) {
  const time = timePartsFromString(timeStr) || { hour: 9, minute: 0 };
  const [year, month, day] = dateStr.split("-").map(Number);
  const epoch = epochFromLa(year, month - 1, day, time.hour, time.minute) + deltaMinutes * 60_000;
  const next = laComponents(epoch);
  return {
    date: `${next.year}-${String(next.month + 1).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`,
    time: minutesToTime(next.hour * 60 + next.minute),
  };
}

function toYmd(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function pickComponent(component, key) {
  return component.get(key);
}

function buildDateFromComponent(component) {
  const year = pickComponent(component, "year");
  const month = pickComponent(component, "month");
  const day = pickComponent(component, "day");
  if (!year || !month || !day) return null;
  return toYmd(year, month, day);
}

function buildTimeFromComponent(component) {
  const hour = pickComponent(component, "hour");
  const minute = pickComponent(component, "minute");
  if (hour == null || minute == null) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function hasExplicitDate(component) {
  return component.isCertain("day")
    || component.isCertain("month")
    || component.isCertain("year")
    || component.isCertain("weekday");
}

function compareTimes(startTime, endTime) {
  const start = timePartsFromString(startTime);
  const end = timePartsFromString(endTime);
  if (!start || !end) return null;
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  return endMinutes - startMinutes;
}

function formatPreview(startDate, startTime, endDate, endTime) {
  if (!startDate) return "";
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const base = new Date(Date.UTC(startYear, startMonth - 1, startDay, 19, 0, 0));
  const dateLabel = base.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (!startTime) return dateLabel;

  const startLabel = new Date(`2000-01-01T${startTime}:00`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (!endTime) return `${dateLabel} at ${startLabel}`;

  const endLabel = new Date(`2000-01-01T${endTime}:00`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (!endDate || endDate === startDate) return `${dateLabel} ${startLabel}-${endLabel}`;

  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const endDateLabel = new Date(Date.UTC(endYear, endMonth - 1, endDay, 19, 0, 0)).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${dateLabel} ${startLabel} to ${endDateLabel} ${endLabel}`;
}

function isSourceProducer(token) {
  const normalized = String(token || "").toLowerCase();
  return normalized === "cal" || normalized === "calendar";
}

function isLocationProducer(token) {
  return String(token || "").startsWith("@");
}

function isTemporalBoundary(tokens, index, now) {
  const remainingTokens = tokens.slice(index).map((token) => token.raw);
  if (!remainingTokens.length) return false;
  const [firstToken] = remainingTokens;
  const normalizedFirst = firstToken.toLowerCase();
  if (isLocationProducer(firstToken) || isSourceProducer(firstToken)) return true;
  if (TEMPORAL_START_WORDS.has(normalizedFirst)) return true;
  if (DATE_LIKE_TOKEN_RE.test(firstToken) || TIME_LIKE_TOKEN_RE.test(firstToken)) return true;
  const parsed = chrono.parse(cleanWhitespace(remainingTokens.join(" ")), new Date(now))[0] || null;
  return !!parsed && parsed.index === 0;
}

function collectProducerQuery(tokens, startIndex, producer, now) {
  const queryTokens = [];
  let nextIndex = startIndex + 1;

  if (producer === "location") {
    const attached = tokens[startIndex]?.raw?.slice(1) || "";
    if (attached) queryTokens.push(attached);
  }

  while (nextIndex < tokens.length) {
    if (isTemporalBoundary(tokens, nextIndex, now)) {
      break;
    }
    const nextToken = tokens[nextIndex]?.raw || "";
    if (isLocationProducer(nextToken) || isSourceProducer(nextToken)) {
      break;
    }
    queryTokens.push(nextToken);
    nextIndex += 1;
  }

  const query = cleanWhitespace(queryTokens.join(" "));
  if (!query || query.length < 2) {
    return null;
  }
  return { query, nextIndex };
}

function extractExplicitTokens(cleanedTitle, options = {}) {
  const {
    now,
    includeLocation = true,
    includeSource = true,
  } = options;
  const tokens = cleanWhitespace(cleanedTitle)
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw }));
  const titleTokens = [];
  let locationQuery = "";
  let sourceQuery = "";

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].raw;

    if (includeLocation && isLocationProducer(token)) {
      const extracted = collectProducerQuery(tokens, index, "location", now);
      if (extracted) {
        locationQuery = extracted.query;
        index = extracted.nextIndex - 1;
        continue;
      }
    }

    if (includeSource && isSourceProducer(token)) {
      const extracted = collectProducerQuery(tokens, index, "source", now);
      if (extracted) {
        sourceQuery = extracted.query;
        index = extracted.nextIndex - 1;
        continue;
      }
    }

    titleTokens.push(token);
  }

  return {
    title: cleanWhitespace(titleTokens.join(" ")),
    locationQuery,
    sourceQuery,
  };
}

function parseTemporalTitle(inputTitle, options = {}) {
  const {
    now,
    baseDate,
    defaultStartTime,
    defaultEndTime,
  } = options;
  const trimmedTitle = cleanWhitespace(inputTitle);
  if (!trimmedTitle) {
    return {
      workingTitle: "",
      matchedText: "",
      parsedDateTime: null,
    };
  }

  const parsed = chrono.parse(trimmedTitle, new Date(now))[0] || null;
  let workingTitle = trimmedTitle;
  let matchedText = "";
  let parsedDateTime = null;

  if (parsed) {
    matchedText = parsed.text || "";
    const before = trimmedTitle.slice(0, parsed.index);
    const after = trimmedTitle.slice(parsed.index + matchedText.length);
    workingTitle = cleanWhitespace(`${before} ${after}`.replace(TRAILING_CONNECTOR_RE, ""));

    const explicitDate = hasExplicitDate(parsed.start);
    const explicitEndDate = parsed.end ? hasExplicitDate(parsed.end) : false;
    const fallbackDate = baseDate || buildDateFromComponent(parsed.start);
    const startDate = explicitDate
      ? buildDateFromComponent(parsed.start)
      : fallbackDate;
    const startTime = buildTimeFromComponent(parsed.start);
    const endDate = parsed.end
      ? (buildDateFromComponent(parsed.end) || startDate)
      : null;
    const endTime = parsed.end
      ? buildTimeFromComponent(parsed.end)
      : null;

    if (startDate) {
      let derivedEndDate = endDate;
      let derivedEndTime = endTime;
      if (startTime && !derivedEndTime) {
        const next = plusMinutes(startDate, startTime, DEFAULT_DURATION_MINUTES);
        derivedEndDate = next.date;
        derivedEndTime = next.time;
      }
      if (startTime && derivedEndTime && !explicitEndDate) {
        const diff = compareTimes(startTime, derivedEndTime);
        derivedEndDate = diff != null && diff < 0
          ? plusMinutes(startDate, startTime, 24 * 60).date
          : startDate;
      }

      parsedDateTime = {
        hasDate: !!startDate,
        hasTime: !!startTime,
        startDate,
        endDate: derivedEndDate || startDate,
        startTime: startTime || null,
        endTime: derivedEndTime || null,
        defaultStartTime,
        defaultEndTime,
      };
    }
  }

  return {
    workingTitle,
    matchedText,
    parsedDateTime,
  };
}

export function parseCalendarTitle(input, options = {}) {
  const rawTitle = String(input || "");
  const trimmed = cleanWhitespace(rawTitle);
  const baseDate = options.baseDate || null;
  const defaultStartTime = options.defaultStartTime || "09:00";
  const defaultEndTime = options.defaultEndTime || "09:30";
  const now = Number.isFinite(options.now) ? options.now : Date.now();

  if (!trimmed) {
    return {
      rawTitle,
      mode: "single",
      cleanTitle: "",
      titleAfterSourceCommit: "",
      titleAfterLocationCommit: "",
      matchedText: "",
      locationQuery: "",
      sourceQuery: "",
      parsedDateTime: null,
      singleDraft: null,
      batchDrafts: [],
      recurrenceDraft: null,
      preview: "",
    };
  }

  const fullyExtracted = extractExplicitTokens(trimmed, {
    now,
    includeLocation: true,
    includeSource: true,
  });
  const sourceCommitted = extractExplicitTokens(trimmed, {
    now,
    includeLocation: false,
    includeSource: true,
  });
  const locationCommitted = extractExplicitTokens(trimmed, {
    now,
    includeLocation: true,
    includeSource: false,
  });
  const intent = parseCalendarIntent(fullyExtracted.title, {
    now,
    baseDate,
    defaultStartTime,
    defaultEndTime,
    parseTemporalTitle,
    cleanTitle: (value) => cleanWhitespace(String(value || "").replace(TRAILING_CONNECTOR_RE, "")),
  });
  const sourceCommitClean = cleanWhitespace(sourceCommitted.title.replace(TRAILING_CONNECTOR_RE, ""));
  const locationCommitClean = cleanWhitespace(locationCommitted.title.replace(TRAILING_CONNECTOR_RE, ""));
  const titleAfterSourceCommit = sourceCommitClean ? `${sourceCommitClean} ` : "";
  const titleAfterLocationCommit = locationCommitClean ? `${locationCommitClean} ` : "";

  return {
    rawTitle,
    mode: intent.mode,
    cleanTitle: intent.cleanTitle,
    titleAfterSourceCommit,
    titleAfterLocationCommit,
    matchedText: intent.matchedText,
    locationQuery: fullyExtracted.locationQuery,
    sourceQuery: fullyExtracted.sourceQuery,
    parsedDateTime: intent.parsedDateTime,
    singleDraft: intent.singleDraft,
    batchDrafts: intent.batchDrafts,
    recurrenceDraft: intent.recurrenceDraft,
    preview: intent.parsedDateTime
      ? formatPreview(
        intent.parsedDateTime.startDate,
        intent.parsedDateTime.startTime,
        intent.parsedDateTime.endDate,
        intent.parsedDateTime.endTime,
      )
      : "",
  };
}
