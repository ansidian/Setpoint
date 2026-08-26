import { epochFromLa, laComponents } from "@/components/inbox/helpers";
import {
  parseCalendarIntent,
  type CalendarIntentContext,
  type CalendarIntentDraft,
  type CalendarTemporalParseResult,
  type ParsedCalendarDateTime,
} from "./calendarTitleIntent";
import type { CalendarRecurrenceInput } from "../../../../shared/types/calendar";
import type { Component, ParsedResult, parse as chronoParse } from "chrono-node/en";

interface ChronoModule { parse: typeof chronoParse }
type ChronoParsedComponent = ParsedResult["start"];

export interface ParseCalendarTitleOptions {
  now?: number;
  baseDate?: string | null;
  defaultStartTime?: string | null;
  defaultEndTime?: string | null;
  defaultDurationMinutes?: number | null;
}

export interface CalendarTitleParseResult {
  rawTitle: string;
  mode: string;
  cleanTitle: string;
  titleAfterSourceCommit: string;
  titleAfterLocationCommit: string;
  matchedText: string;
  locationQuery: string;
  sourceQuery: string;
  parsedDateTime: ParsedCalendarDateTime | null;
  singleDraft: CalendarIntentDraft | null;
  batchDrafts: CalendarIntentDraft[];
  recurrenceDraft: (CalendarRecurrenceInput & Partial<CalendarIntentDraft>) | null;
  preview: string;
}

interface ExplicitTokenOptions {
  now: number;
  includeLocation?: boolean;
  includeSource?: boolean;
}

interface CalendarAssistToken { raw: string }

// chrono-node/en is ~530KB ESM and most calendar-modal opens never invoke the
// natural-language date parser (it only fires once a temporal token is typed).
// Loading it eagerly dragged the whole parser into the calendar-open payload via
// the static import chain (parseCalendarTitle -> useCalendarEventEditor ->
// useCalendarModalController -> the lazy CalendarModal route). It is now loaded
// on demand and cached in a module singleton. parseCalendarTitle stays
// synchronous: until chrono lands, the chrono-derived parse degrades to "no
// temporal match" for that call (recurrence/weekday/explicit-date regexes still
// work), and callers warm + re-parse once it is ready via ensureChrono().
let chronoEn: ChronoModule | null = null;
let chronoLoadPromise: Promise<ChronoModule> | null = null;
const chronoReadyListeners = new Set<() => void>();

export function isChronoReady() {
  return !!chronoEn;
}

export function ensureChrono() {
  if (chronoEn) return Promise.resolve(chronoEn);
  if (!chronoLoadPromise) {
    chronoLoadPromise = import("chrono-node/en").then((mod) => {
      chronoEn = mod;
      const listeners = [...chronoReadyListeners];
      chronoReadyListeners.clear();
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          // a failing ready-listener must not reject the shared load promise
        }
      }
      return mod;
    });
  }
  return chronoLoadPromise;
}

// Register a one-shot callback fired when chrono finishes loading. Returns an
// unsubscribe fn. If chrono is already loaded the callback is not called (the
// caller can check isChronoReady() first).
export function subscribeChronoReady(listener: () => void) {
  if (typeof listener !== "function" || chronoEn) return () => {};
  chronoReadyListeners.add(listener);
  return () => chronoReadyListeners.delete(listener);
}

// Synchronous accessor used inside the parse paths. Returns the loaded chrono
// module or null, kicking off a background load on the first miss so the next
// re-parse (warmed by the editor) gets the full result.
function chronoOrLoad() {
  if (chronoEn) return chronoEn;
  ensureChrono();
  return null;
}

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
const RECURRENCE_TOKEN_RE = /\b(?:every|daily|weekly|monthly|yearly|annually|biweekly|first|1st|second|2nd|third|3rd|fourth|4th|last)\b/i;

function cleanWhitespace(value: unknown) {
  return String(value || "").replace(/\s{2,}/g, " ").trim();
}

function currentPacificDate(now: number) {
  const current = laComponents(now);
  return toYmd(current.year, current.month + 1, current.day);
}

function timePartsFromString(value: string | null | undefined) {
  if (!value) return null;
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function minutesToTime(minutes: number) {
  const clamped = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function plusMinutes(dateStr: string, timeStr: string | null | undefined, deltaMinutes: number) {
  const time = timePartsFromString(timeStr) || { hour: 9, minute: 0 };
  const [year, month, day] = dateStr.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return { date: dateStr, time: minutesToTime(time.hour * 60 + time.minute) };
  }
  const epoch = epochFromLa(year, month - 1, day, time.hour, time.minute) + deltaMinutes * 60_000;
  const next = laComponents(epoch);
  return {
    date: `${next.year}-${String(next.month + 1).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`,
    time: minutesToTime(next.hour * 60 + next.minute),
  };
}

function toYmd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function pickComponent(component: ChronoParsedComponent, key: Component) {
  return component.get(key);
}

function buildDateFromComponent(component: ChronoParsedComponent) {
  const year = pickComponent(component, "year");
  const month = pickComponent(component, "month");
  const day = pickComponent(component, "day");
  if (!year || !month || !day) return null;
  return toYmd(year, month, day);
}

function buildTimeFromComponent(component: ChronoParsedComponent) {
  const hour = pickComponent(component, "hour");
  const minute = pickComponent(component, "minute");
  if (hour == null || minute == null) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function hasExplicitDate(component: ChronoParsedComponent) {
  return component.isCertain("day")
    || component.isCertain("month")
    || component.isCertain("year")
    || component.isCertain("weekday");
}

function compareTimes(startTime: string | null | undefined, endTime: string | null | undefined) {
  const start = timePartsFromString(startTime);
  const end = timePartsFromString(endTime);
  if (!start || !end) return null;
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  return endMinutes - startMinutes;
}

function formatPreview(
  startDate: string | null,
  startTime: string | null,
  endDate: string | null,
  endTime: string | null,
) {
  if (!startDate) return "";
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const base = new Date(Date.UTC(startYear ?? 1970, (startMonth ?? 1) - 1, startDay ?? 1, 19, 0, 0));
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
  const endDateLabel = new Date(Date.UTC(endYear ?? 1970, (endMonth ?? 1) - 1, endDay ?? 1, 19, 0, 0)).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${dateLabel} ${startLabel} to ${endDateLabel} ${endLabel}`;
}

function isSourceProducer(token: unknown) {
  const normalized = String(token || "").toLowerCase();
  return normalized === "cal" || normalized === "calendar";
}

function isLocationProducer(token: unknown) {
  return String(token || "").startsWith("@");
}

function hasCalendarAssistSyntax(title: string) {
  if (!title) return false;
  const tokens = cleanWhitespace(title).split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (RECURRENCE_TOKEN_RE.test(title)) return true;
  return tokens.some((token) => {
    const normalized = token.toLowerCase().replace(/[.,]$/g, "");
    return isLocationProducer(token)
      || isSourceProducer(normalized)
      || TEMPORAL_START_WORDS.has(normalized)
      || DATE_LIKE_TOKEN_RE.test(normalized)
      || TIME_LIKE_TOKEN_RE.test(normalized);
  });
}

function isTemporalBoundary(tokens: CalendarAssistToken[], index: number, now: number) {
  const remainingTokens = tokens.slice(index).map((token) => token.raw);
  if (!remainingTokens.length) return false;
  const [firstToken] = remainingTokens;
  if (!firstToken) return false;
  const normalizedFirst = firstToken.toLowerCase();
  if (isLocationProducer(firstToken) || isSourceProducer(firstToken)) return true;
  if (TEMPORAL_START_WORDS.has(normalizedFirst)) return true;
  if (DATE_LIKE_TOKEN_RE.test(firstToken) || TIME_LIKE_TOKEN_RE.test(firstToken)) return true;
  const chrono = chronoOrLoad();
  if (!chrono) return false;
  const parsed = chrono.parse(cleanWhitespace(remainingTokens.join(" ")), new Date(now))[0] || null;
  return !!parsed && parsed.index === 0;
}

function collectProducerQuery(
  tokens: CalendarAssistToken[],
  startIndex: number,
  producer: "location" | "source",
  now: number,
) {
  const queryTokens: string[] = [];
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

function extractExplicitTokens(cleanedTitle: string, options: ExplicitTokenOptions) {
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
    const token = tokens[index]!.raw;

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

function parseTemporalTitle(
  inputTitle: string,
  options: CalendarIntentContext,
): CalendarTemporalParseResult {
  const {
    now,
    baseDate,
    defaultStartTime,
    defaultEndTime,
    defaultDurationMinutes,
  } = options;
  const trimmedTitle = cleanWhitespace(inputTitle);
  if (!trimmedTitle) {
    return {
      workingTitle: "",
      matchedText: "",
      parsedDateTime: null,
    };
  }

  const chrono = chronoOrLoad();
  const parsed = chrono ? (chrono.parse(trimmedTitle, new Date(now))[0] || null) : null;
  let workingTitle = trimmedTitle;
  let matchedText = "";
  let parsedDateTime: ParsedCalendarDateTime | null = null;

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
        const durationMinutes = Number.isFinite(defaultDurationMinutes) && Number(defaultDurationMinutes) >= 0
          ? Number(defaultDurationMinutes)
          : DEFAULT_DURATION_MINUTES;
        const next = plusMinutes(startDate, startTime, durationMinutes);
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

export function parseCalendarTitle(
  input: unknown,
  options: ParseCalendarTitleOptions = {},
): CalendarTitleParseResult {
  const rawTitle = String(input || "");
  const trimmed = cleanWhitespace(rawTitle);
  const baseDate = options.baseDate || null;
  const defaultStartTime = options.defaultStartTime || "09:00";
  const defaultEndTime = options.defaultEndTime || "09:30";
  const defaultDurationMinutes = options.defaultDurationMinutes;
  const now = Number.isFinite(options.now) ? (options.now ?? Date.now()) : Date.now();

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

  if (!hasCalendarAssistSyntax(trimmed)) {
    const startDate = baseDate || currentPacificDate(now);
    return {
      rawTitle,
      mode: "single",
      cleanTitle: trimmed,
      titleAfterSourceCommit: "",
      titleAfterLocationCommit: "",
      matchedText: "",
      locationQuery: "",
      sourceQuery: "",
      parsedDateTime: null,
      singleDraft: {
        title: trimmed,
        allDay: false,
        startDate,
        endDate: startDate,
        startTime: defaultStartTime,
        endTime: defaultEndTime,
      },
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
    defaultDurationMinutes,
    parseTemporalTitle,
    cleanTitle: (value: string) => cleanWhitespace(String(value || "").replace(TRAILING_CONNECTOR_RE, "")),
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
