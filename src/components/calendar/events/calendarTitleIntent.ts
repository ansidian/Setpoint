import { epochFromLa, laComponents } from "@/components/inbox/helpers";
import {
  matchCalendarRecurrenceClause,
  type CalendarWeekdayCode,
} from "./calendarRecurrenceClauseModel";

export type { CalendarWeekdayCode } from "./calendarRecurrenceClauseModel";

export interface ParsedCalendarDateTime {
  hasDate?: boolean;
  hasTime?: boolean;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  defaultStartTime?: string | null;
  defaultEndTime?: string | null;
}

export interface CalendarIntentDraft {
  title: string;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface CalendarTemporalParseResult {
  workingTitle: string;
  matchedText: string;
  parsedDateTime: ParsedCalendarDateTime | null;
}

export interface CalendarIntentContext {
  now: number;
  baseDate?: string | null;
  defaultStartTime?: string | null;
  defaultEndTime?: string | null;
  defaultDurationMinutes?: number | null;
  parseTemporalTitle: (title: string, context: CalendarIntentContext) => CalendarTemporalParseResult;
  cleanTitle: (title: string) => string;
}

interface CalendarIntentFallbacks {
  startDate?: string | null;
  endDate?: string | null;
  defaultStartTime?: string | null;
  defaultEndTime?: string | null;
}

const WEEKDAY_INDEX_BY_CODE: Record<CalendarWeekdayCode, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const WEEKDAY_CODE_BY_TOKEN: Record<string, CalendarWeekdayCode> = {
  sun: "SU",
  sunday: "SU",
  mon: "MO",
  monday: "MO",
  tue: "TU",
  tues: "TU",
  tuesday: "TU",
  wed: "WE",
  weds: "WE",
  wednesday: "WE",
  thu: "TH",
  thur: "TH",
  thurs: "TH",
  thursday: "TH",
  fri: "FR",
  friday: "FR",
  sat: "SA",
  saturday: "SA",
};

const DATE_LIST_ITEM_RE = /(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/gi;
const WEEKDAY_TOKEN_PATTERN = "(?:sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday|s)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\\b";
const WEEKDAY_LIST_PATTERN = `(?:${WEEKDAY_TOKEN_PATTERN})(?:\\s*(?:,|and)?\\s+(?:${WEEKDAY_TOKEN_PATTERN}))*|weekdays?|weekends?`;
const WEEKLY_RECURRING_RE = new RegExp(`\\bevery\\s+(${WEEKDAY_LIST_PATTERN})`, "i");

function clampTime(value?: string | null, fallback?: string | null) {
  return value || fallback || null;
}

function toYmd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseYmd(value: string | null | undefined) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function addDays(dateStr: string, days: number) {
  const parts = parseYmd(dateStr);
  if (!parts) return dateStr;
  const epoch = epochFromLa(parts.year, parts.month - 1, parts.day, 12, 0) + days * 24 * 60 * 60 * 1000;
  const next = laComponents(epoch);
  return toYmd(next.year, next.month + 1, next.day);
}

function compareYmd(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function currentPacificDate(now: number) {
  const current = laComponents(now);
  return toYmd(current.year, current.month + 1, current.day);
}

function weekdaysFromListText(listText: string | null | undefined) {
  if (!listText) return [];
  const normalized = String(listText)
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\bweekdays?\b/g, "monday tuesday wednesday thursday friday")
    .replace(/\bweekends?\b/g, "saturday sunday")
    .replace(/\band\b/g, " ")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return [];

  const codes: CalendarWeekdayCode[] = [];
  for (const token of normalized.split(" ")) {
    if (!token || token === "on") continue;
    const code = WEEKDAY_CODE_BY_TOKEN[token];
    if (!code) return [];
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

function resolveWeekdayOccurrence(
  baseDate: string,
  code: CalendarWeekdayCode,
  qualifier: "next" | "this" | string = "next",
) {
  const parts = parseYmd(baseDate);
  if (!parts) return null;
  const baseEpoch = epochFromLa(parts.year, parts.month - 1, parts.day, 12, 0);
  const base = new Date(baseEpoch);
  const baseWeekday = base.getDay();
  const targetWeekday = WEEKDAY_INDEX_BY_CODE[code];
  if (targetWeekday == null) return null;

  let delta = (targetWeekday - baseWeekday + 7) % 7;
  if (qualifier === "next") {
    delta += 7;
  }
  const next = new Date(base);
  next.setDate(next.getDate() + delta);
  return toYmd(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

function normalizeParsedDraft(
  title: string,
  parsedDateTime: ParsedCalendarDateTime | null | undefined,
  fallbacks: CalendarIntentFallbacks = {},
): CalendarIntentDraft | null {
  if (!title && !parsedDateTime) return null;
  const startDate = parsedDateTime?.startDate || fallbacks.startDate || null;
  const endDate = parsedDateTime?.endDate || startDate || fallbacks.endDate || null;
  const startTime = clampTime(parsedDateTime?.startTime, fallbacks.defaultStartTime);
  const endTime = clampTime(parsedDateTime?.endTime, fallbacks.defaultEndTime);

  return {
    title,
    allDay: false,
    startDate,
    endDate: endDate || startDate,
    startTime,
    endTime,
  };
}

function buildBatchDraft(baseDraft: CalendarIntentDraft | null, date: string | null): CalendarIntentDraft | null {
  if (!baseDraft || !date) return null;
  return {
    ...baseDraft,
    startDate: date,
    endDate: baseDraft.endDate === baseDraft.startDate
      ? date
      : addDays(date, Math.max(0, daySpan(baseDraft.startDate, baseDraft.endDate))),
  };
}

function daySpan(startDate: string | null, endDate: string | null) {
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);
  if (!start || !end) return 0;
  const startEpoch = epochFromLa(start.year, start.month - 1, start.day, 12, 0);
  const endEpoch = epochFromLa(end.year, end.month - 1, end.day, 12, 0);
  return Math.round((endEpoch - startEpoch) / (24 * 60 * 60 * 1000));
}

function parseListClauseTitle(rawTitle: string, clauseStart: number, clauseEnd: number) {
  return String(`${rawTitle.slice(0, clauseStart)} ${rawTitle.slice(clauseEnd)}`)
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseExplicitDate(value: string | null | undefined, baseDate: string) {
  if (!value) return null;
  const iso = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return toYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const slash = String(value).match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!slash) return null;

  const base = parseYmd(baseDate) || parseYmd(currentPacificDate(Date.now()));
  let year = slash[3] ? Number(slash[3]) : base?.year;
  if (!year) return null;
  if (year < 100) year += 2000;
  return toYmd(year, Number(slash[1]), Number(slash[2]));
}

function parseWeeklyRecurringIntent(title: string, context: CalendarIntentContext) {
  const match = title.match(WEEKLY_RECURRING_RE);
  if (!match) return null;

  const weekdays = weekdaysFromListText(match[1]);
  if (!weekdays.length) return null;

  const clauseStart = match.index ?? 0;
  const clauseEnd = clauseStart + match[0].length;
  const titleWithoutRule = parseListClauseTitle(title, clauseStart, clauseEnd);
  const temporal = context.parseTemporalTitle(titleWithoutRule, context);
  const cleanTitle = context.cleanTitle(temporal.workingTitle);
  const anchorBaseDate = context.baseDate || currentPacificDate(context.now);
  const startDate = resolveWeekdayOccurrence(anchorBaseDate, weekdays[0]!, "this");
  const recurringDateTime = temporal.parsedDateTime
    ? { ...temporal.parsedDateTime, startDate, endDate: startDate }
    : null;
  const singleDraft = normalizeParsedDraft(cleanTitle, recurringDateTime, {
    startDate,
    endDate: startDate,
    defaultStartTime: context.defaultStartTime,
    defaultEndTime: context.defaultEndTime,
  });

  return {
    mode: "recurring",
    cleanTitle,
    matchedText: [temporal.matchedText, match[0]].filter(Boolean).join(" ").trim(),
    parsedDateTime: singleDraft
      ? {
          hasDate: true,
          hasTime: !!temporal.parsedDateTime?.startTime,
          startDate: singleDraft.startDate,
          endDate: singleDraft.endDate,
          startTime: singleDraft.startTime,
          endTime: singleDraft.endTime,
          defaultStartTime: context.defaultStartTime,
          defaultEndTime: context.defaultEndTime,
        }
      : temporal.parsedDateTime,
    singleDraft,
    batchDrafts: [],
    recurrenceDraft: singleDraft
      ? {
          frequency: "weekly",
          interval: 1,
          weekdays,
          ends: { type: "never" as const },
          startDate: singleDraft.startDate,
          endDate: singleDraft.endDate,
          startTime: singleDraft.startTime,
          endTime: singleDraft.endTime,
        }
      : null,
  };
}

function scanWeekdayList(title: string) {
  const QUALIFIER_RE = /^(next|this)$/i;
  const SEPARATOR_RE = /^(,|and)$/i;
  const tokens = title.split(/(\s+|,)/).filter((t) => t.trim());
  const entries: Array<{ code: CalendarWeekdayCode; qualifier: string }> = [];
  let clauseStart = -1;
  let clauseEnd = -1;
  let cursor = 0;
  let charPos = 0;
  let lastExplicitQualifier = "this";

  while (cursor < tokens.length) {
    const token = tokens[cursor]!;
    const tokenStart = title.indexOf(token, charPos);
    let qualifier = lastExplicitQualifier;
    let weekdayToken = null;
    let entryEnd = tokenStart + token.length;

    if (QUALIFIER_RE.test(token) && cursor + 1 < tokens.length) {
      const nextToken = tokens[cursor + 1]!;
      const code = WEEKDAY_CODE_BY_TOKEN[nextToken.toLowerCase().replace(/[.,]/g, "")];
      if (code) {
        qualifier = token.toLowerCase();
        lastExplicitQualifier = qualifier;
        weekdayToken = nextToken;
        entryEnd = title.indexOf(nextToken, tokenStart) + nextToken.length;
        cursor += 2;
      }
    }

    if (!weekdayToken) {
      const code = WEEKDAY_CODE_BY_TOKEN[token.toLowerCase().replace(/[.,]/g, "")];
      if (code) {
        weekdayToken = token;
        entryEnd = tokenStart + token.length;
        cursor += 1;
      }
    }

    if (weekdayToken) {
      const code = WEEKDAY_CODE_BY_TOKEN[weekdayToken.toLowerCase().replace(/[.,]/g, "")];
      if (code) {
        if (clauseStart < 0) clauseStart = tokenStart;
        clauseEnd = entryEnd;
        entries.push({ code, qualifier });

        while (cursor < tokens.length && SEPARATOR_RE.test(tokens[cursor]!.trim())) {
          cursor += 1;
        }
        continue;
      }
    }

    if (entries.length >= 2) break;
    entries.length = 0;
    clauseStart = -1;
    clauseEnd = -1;
    charPos = tokenStart + token.length;
    cursor += 1;
  }

  if (entries.length < 2) return null;
  return {
    entries,
    clauseStart,
    clauseEnd,
    clauseText: title.slice(clauseStart, clauseEnd),
  };
}

function parseWeekdayBatchIntent(title: string, context: CalendarIntentContext) {
  const scan = scanWeekdayList(title);
  if (!scan) return null;

  const titleWithoutClause = parseListClauseTitle(title, scan.clauseStart, scan.clauseEnd);
  const temporal = context.parseTemporalTitle(titleWithoutClause, context);
  const cleanTitle = context.cleanTitle(temporal.workingTitle);
  const anchorBaseDate = context.baseDate || currentPacificDate(context.now);
  const baseDraft = normalizeParsedDraft(cleanTitle, temporal.parsedDateTime, {
    startDate: anchorBaseDate,
    endDate: anchorBaseDate,
    defaultStartTime: context.defaultStartTime,
    defaultEndTime: context.defaultEndTime,
  });
  const dates = [
    ...new Set(
      scan.entries
        .map((entry) => resolveWeekdayOccurrence(anchorBaseDate, entry.code, entry.qualifier))
        .filter((date): date is string => Boolean(date)),
    ),
  ].sort(compareYmd);
  const batchDrafts = dates
    .map((date) => buildBatchDraft(baseDraft, date))
    .filter((draft): draft is CalendarIntentDraft => Boolean(draft));

  return {
    mode: "batch",
    cleanTitle,
    matchedText: [scan.clauseText, temporal.matchedText].filter(Boolean).join(" ").trim(),
    parsedDateTime: batchDrafts[0]
      ? {
          hasDate: true,
          hasTime: !!temporal.parsedDateTime?.startTime,
          startDate: batchDrafts[0].startDate,
          endDate: batchDrafts[0].endDate,
          startTime: batchDrafts[0].startTime,
          endTime: batchDrafts[0].endTime,
          defaultStartTime: context.defaultStartTime,
          defaultEndTime: context.defaultEndTime,
        }
      : temporal.parsedDateTime,
    singleDraft: batchDrafts[0] || baseDraft,
    batchDrafts,
    recurrenceDraft: null,
  };
}

function parseExplicitDateBatchIntent(title: string, context: CalendarIntentContext) {
  const matches = [...title.matchAll(DATE_LIST_ITEM_RE)];
  if (matches.length < 2) return null;

  const firstIndex = matches[0]?.index ?? -1;
  const lastMatch = matches[matches.length - 1];
  const lastIndex = (lastMatch?.index ?? -1) + String(lastMatch?.[0] || "").length;
  const listText = title.slice(firstIndex, lastIndex);
  const normalizedList = listText.replace(/\s+/g, "");
  const normalizedMatches = matches.map((match) => match[0]).join(",");
  if (normalizedList.replace(/and/gi, ",") !== normalizedMatches) return null;

  const titleWithoutClause = parseListClauseTitle(title, firstIndex, lastIndex);
  const temporal = context.parseTemporalTitle(titleWithoutClause, context);
  const cleanTitle = context.cleanTitle(temporal.workingTitle);
  const baseDraft = normalizeParsedDraft(cleanTitle, temporal.parsedDateTime, {
    defaultStartTime: context.defaultStartTime,
    defaultEndTime: context.defaultEndTime,
  });

  const dates = [
    ...new Set(
      matches
        .map((match) => parseExplicitDate(match[0], context.baseDate || currentPacificDate(context.now)))
        .filter((date): date is string => Boolean(date)),
    ),
  ].sort(compareYmd);
  if (dates.length < 2) return null;

  const batchDrafts = dates
    .map((date) => buildBatchDraft(baseDraft, date))
    .filter((draft): draft is CalendarIntentDraft => Boolean(draft));

  return {
    mode: "batch",
    cleanTitle,
    matchedText: [listText, temporal.matchedText].filter(Boolean).join(" ").trim(),
    parsedDateTime: batchDrafts[0]
      ? {
          hasDate: true,
          hasTime: !!temporal.parsedDateTime?.startTime,
          startDate: batchDrafts[0].startDate,
          endDate: batchDrafts[0].endDate,
          startTime: batchDrafts[0].startTime,
          endTime: batchDrafts[0].endTime,
          defaultStartTime: context.defaultStartTime,
          defaultEndTime: context.defaultEndTime,
        }
      : temporal.parsedDateTime,
    singleDraft: batchDrafts[0] || baseDraft,
    batchDrafts,
    recurrenceDraft: null,
  };
}

function weekdayCodeFromDate(dateStr: string): CalendarWeekdayCode {
  const parts = parseYmd(dateStr);
  if (!parts) return "MO";
  const dow = new Date(epochFromLa(parts.year, parts.month - 1, parts.day, 12, 0)).getDay();
  return (Object.entries(WEEKDAY_INDEX_BY_CODE).find(([, v]) => v === dow)?.[0] as CalendarWeekdayCode | undefined) || "MO";
}

function buildGeneralRecurringResult(
  frequency: "daily" | "weekly" | "monthly" | "yearly",
  interval: number,
  weekdays: CalendarWeekdayCode[],
  title: string,
  context: CalendarIntentContext,
  matchedClause: { index: number; length: number; text: string },
) {
  const titleWithoutRule = parseListClauseTitle(title, matchedClause.index, matchedClause.index + matchedClause.length);
  const temporal = context.parseTemporalTitle(titleWithoutRule, context);
  const cleanTitle = context.cleanTitle(temporal.workingTitle);
  const anchorBaseDate = context.baseDate || currentPacificDate(context.now);

  let startDate = anchorBaseDate;
  if (frequency === "weekly" && weekdays.length) {
    startDate = resolveWeekdayOccurrence(anchorBaseDate, weekdays[0]!, "this") || anchorBaseDate;
  }

  const singleDraft = normalizeParsedDraft(cleanTitle, temporal.parsedDateTime, {
    startDate,
    endDate: startDate,
    defaultStartTime: context.defaultStartTime,
    defaultEndTime: context.defaultEndTime,
  });

  return {
    mode: "recurring",
    cleanTitle,
    matchedText: [temporal.matchedText, matchedClause.text].filter(Boolean).join(" ").trim(),
    parsedDateTime: singleDraft
      ? {
          hasDate: true,
          hasTime: !!temporal.parsedDateTime?.startTime,
          startDate: singleDraft.startDate,
          endDate: singleDraft.endDate,
          startTime: singleDraft.startTime,
          endTime: singleDraft.endTime,
          defaultStartTime: context.defaultStartTime,
          defaultEndTime: context.defaultEndTime,
        }
      : temporal.parsedDateTime,
    singleDraft,
    batchDrafts: [],
    recurrenceDraft: singleDraft
      ? {
          frequency,
          interval,
          weekdays: frequency === "weekly" ? weekdays : [],
          ends: { type: "never" as const },
          startDate: singleDraft.startDate,
          endDate: singleDraft.endDate,
          startTime: singleDraft.startTime,
          endTime: singleDraft.endTime,
        }
      : null,
  };
}

function parseGeneralRecurringIntent(title: string, context: CalendarIntentContext) {
  const baseDate = context.baseDate || currentPacificDate(context.now);
  const match = matchCalendarRecurrenceClause(title, weekdayCodeFromDate(baseDate));
  if (!match) return null;

  return buildGeneralRecurringResult(
    match.frequency,
    match.interval,
    match.weekdays,
    title,
    context,
    match.clause,
  );
}

export function parseCalendarIntent(title: string, context: CalendarIntentContext) {
  const weeklyRecurring = parseWeeklyRecurringIntent(title, context);
  if (weeklyRecurring) return weeklyRecurring;

  const generalRecurring = parseGeneralRecurringIntent(title, context);
  if (generalRecurring) return generalRecurring;

  const weekdayBatch = parseWeekdayBatchIntent(title, context);
  if (weekdayBatch) return weekdayBatch;

  const explicitDateBatch = parseExplicitDateBatchIntent(title, context);
  if (explicitDateBatch) return explicitDateBatch;

  const temporal = context.parseTemporalTitle(title, context);
  const cleanTitle = context.cleanTitle(temporal.workingTitle);
  const singleDraft = normalizeParsedDraft(cleanTitle, temporal.parsedDateTime, {
    startDate: context.baseDate || currentPacificDate(context.now),
    endDate: context.baseDate || currentPacificDate(context.now),
    defaultStartTime: context.defaultStartTime,
    defaultEndTime: context.defaultEndTime,
  });

  return {
    mode: "single",
    cleanTitle,
    matchedText: temporal.matchedText,
    parsedDateTime: temporal.parsedDateTime,
    singleDraft,
    batchDrafts: [],
    recurrenceDraft: null,
  };
}
