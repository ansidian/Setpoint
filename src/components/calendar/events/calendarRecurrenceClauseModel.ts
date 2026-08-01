export type CalendarWeekdayCode = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";

type CalendarRecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

interface CalendarRecurrenceClauseMatch {
  frequency: CalendarRecurrenceFrequency;
  interval: number;
  weekdays: CalendarWeekdayCode[];
  clause: {
    index: number;
    length: number;
    text: string;
  };
}

const FREQUENCY_KEYWORDS: Record<string, CalendarRecurrenceFrequency> = {
  daily: "daily",
  day: "daily",
  weekly: "weekly",
  week: "weekly",
  monthly: "monthly",
  month: "monthly",
  yearly: "yearly",
  year: "yearly",
  annually: "yearly",
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

const WEEKDAY_PATTERN = "sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday|s)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?";
const EVERY_OTHER_RE = new RegExp(`\\bevery\\s+other\\s+(${WEEKDAY_PATTERN})\\b`, "i");
const ORDINAL_WEEKDAY_RE = new RegExp(`\\b(first|1st|second|2nd|third|3rd|fourth|4th|last)\\s+(${WEEKDAY_PATTERN})\\s+(?:of\\s+)?every\\s+month\\b`, "i");

function createMatch(
  match: RegExpMatchArray,
  frequency: CalendarRecurrenceFrequency,
  interval: number,
  weekdays: CalendarWeekdayCode[],
): CalendarRecurrenceClauseMatch {
  return {
    frequency,
    interval,
    weekdays,
    clause: {
      index: match.index ?? 0,
      length: match[0].length,
      text: match[0],
    },
  };
}

function weekdayFromToken(value: string | undefined) {
  return value ? WEEKDAY_CODE_BY_TOKEN[value.toLowerCase()] || null : null;
}

/** Recognizes the general recurrence clause forms supported by calendar title intent. */
export function matchCalendarRecurrenceClause(
  title: string,
  defaultWeekday: CalendarWeekdayCode,
): CalendarRecurrenceClauseMatch | null {
  const biweeklyMatch = title.match(/\bbiweekly\b/i);
  if (biweeklyMatch) {
    return createMatch(biweeklyMatch, "weekly", 2, [defaultWeekday]);
  }

  const everyOtherMatch = title.match(EVERY_OTHER_RE);
  const everyOtherWeekday = weekdayFromToken(everyOtherMatch?.[1]);
  if (everyOtherMatch && everyOtherWeekday) {
    return createMatch(everyOtherMatch, "weekly", 2, [everyOtherWeekday]);
  }

  const everyNMatch = title.match(/\bevery\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\b/i);
  if (everyNMatch) {
    const interval = Number(everyNMatch[1]);
    const frequency = FREQUENCY_KEYWORDS[everyNMatch[2]!.toLowerCase().replace(/s$/, "")];
    if (frequency && interval > 0) {
      return createMatch(everyNMatch, frequency, interval, frequency === "weekly" ? [defaultWeekday] : []);
    }
  }

  const ordinalWeekdayMatch = title.match(ORDINAL_WEEKDAY_RE);
  if (ordinalWeekdayMatch && weekdayFromToken(ordinalWeekdayMatch[2])) {
    return createMatch(ordinalWeekdayMatch, "monthly", 1, []);
  }

  const standaloneMatch = title.match(/\b(daily|weekly|monthly|yearly|annually)\b/i);
  if (standaloneMatch) {
    const frequency = FREQUENCY_KEYWORDS[standaloneMatch[1]!.toLowerCase()];
    if (frequency) {
      return createMatch(standaloneMatch, frequency, 1, frequency === "weekly" ? [defaultWeekday] : []);
    }
  }

  const everyFrequencyMatch = title.match(/\bevery\s+(day|week|month|year)\b/i);
  if (everyFrequencyMatch) {
    const frequency = FREQUENCY_KEYWORDS[everyFrequencyMatch[1]!.toLowerCase()];
    if (frequency) {
      return createMatch(everyFrequencyMatch, frequency, 1, frequency === "weekly" ? [defaultWeekday] : []);
    }
  }

  return null;
}
