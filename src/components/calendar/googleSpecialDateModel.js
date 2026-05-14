export const GOOGLE_SPECIAL_DATE_SOURCE_LABEL = "Birthdays";
export const GOOGLE_SPECIAL_DATE_COLOR = "#ff887c";

function normalizedValue(value) {
  return String(value || "").trim().toLowerCase();
}

function sourceLooksLikeGoogleSpecialDate(item) {
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

export function isGoogleSpecialDateEvent(item) {
  if (!item || (item.type && item.type !== "event")) return false;
  return item.specialDate === true
    || item.eventType === "birthday"
    || item.readOnlyReason === "birthday"
    || item.payload?.eventType === "birthday"
    || item.payload?.readOnlyReason === "birthday"
    || sourceLooksLikeGoogleSpecialDate(item);
}

export function googleSpecialDateType(item) {
  return item?.birthdayProperties?.type
    || item?.payload?.birthdayProperties?.type
    || "birthday";
}

export function googleSpecialDateLabel(item) {
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

export function googleSpecialDateAccent(item) {
  return item?.sourceColor
    || item?.payload?.sourceColor
    || item?.color
    || item?.payload?.color
    || GOOGLE_SPECIAL_DATE_COLOR;
}
