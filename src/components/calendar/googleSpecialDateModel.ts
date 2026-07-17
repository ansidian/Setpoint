export const GOOGLE_SPECIAL_DATE_SOURCE_LABEL = "Birthdays";
export const GOOGLE_SPECIAL_DATE_COLOR = "#ff887c";

interface SpecialDateItem {
  type?: string; source?: string; sourceLabel?: string; calendarName?: string; meta?: string;
  specialDate?: boolean; eventType?: string; readOnlyReason?: string; sourceColor?: string; color?: string;
  birthdayProperties?: { type?: string; customTypeName?: string };
  payload?: SpecialDateItem;
}
function asSpecialDateItem(item: unknown): SpecialDateItem | null {
  return item && typeof item === "object" ? item as SpecialDateItem : null;
}

function normalizedValue(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function sourceLooksLikeGoogleSpecialDate(input?: unknown): boolean {
  const item = asSpecialDateItem(input);
  return [
    item?.source,
    item?.sourceLabel,
    item?.calendarName,
    item?.meta,
    item?.payload?.source,
    item?.payload?.sourceLabel,
    item?.payload?.calendarName,
  ].some((value) => normalizedValue(value) === normalizedValue(GOOGLE_SPECIAL_DATE_SOURCE_LABEL));
}

export function isGoogleSpecialDateEvent(input?: unknown): boolean {
  const item = asSpecialDateItem(input);
  if (!item || (item.type && item.type !== "event")) return false;
  return item.specialDate === true
    || item.eventType === "birthday"
    || item.readOnlyReason === "birthday"
    || item.payload?.eventType === "birthday"
    || item.payload?.readOnlyReason === "birthday"
    || sourceLooksLikeGoogleSpecialDate(item);
}

export function googleSpecialDateType(input?: unknown): string {
  const item = asSpecialDateItem(input);
  return item?.birthdayProperties?.type
    || item?.payload?.birthdayProperties?.type
    || "birthday";
}

export function googleSpecialDateLabel(input?: unknown): string | null {
  const item = asSpecialDateItem(input);
  if (!isGoogleSpecialDateEvent(item)) return null;
  const type = googleSpecialDateType(item);
  if (type === "anniversary") return "Anniversary";
  if (type === "custom") {
    return item?.birthdayProperties?.customTypeName
      || item?.payload?.birthdayProperties?.customTypeName
      || "Special date";
  }
  if (type === "other") return "Special date";
  return "Birthday";
}

export function googleSpecialDateAccent(input?: unknown): string {
  const item = asSpecialDateItem(input);
  return item?.sourceColor
    || item?.payload?.sourceColor
    || item?.color
    || item?.payload?.color
    || GOOGLE_SPECIAL_DATE_COLOR;
}
