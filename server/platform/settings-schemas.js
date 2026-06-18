// Write-boundary validation for the JSON blobs on ea_settings (D-AUTH-2).
// Readers (scheduler, triage worker, settings GET) stay tolerant of legacy
// rows; these validators reject malformed payloads at write time instead of
// letting bad data surface at read/use time.
// triage_sound_settings and bill_pay_mappings have their own validators in
// triage-sound-settings.js / bill-pay-mappings.js.

const SCHEDULE_TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const IMPORTANT_SENDER_SOURCES = new Set(["manual", "auto"]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isValidTimeZone(tz) {
  if (!isNonBlankString(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseMaybeJson(value, label) {
  if (typeof value !== "string") return { ok: true, value };
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false, message: `Invalid ${label}: not valid JSON` };
  }
}

// Schedule entries drive cron registration in scheduler.js: `time` is split
// into hour/minute, `label` + `time` identify the row for skip checks, `tz`
// is passed to node-cron, `skipped_until` is compared against `new Date()`.
export function validateSchedules(value) {
  const parsed = parseMaybeJson(value, "schedules_json");
  if (!parsed.ok) return { valid: false, message: parsed.message };
  const schedules = parsed.value;
  if (!Array.isArray(schedules)) {
    return { valid: false, message: "Invalid schedules_json: must be an array" };
  }
  // MERGE-NOTE[P3-57] (P3 worktree): reject duplicate (time,label) pairs so the
  // identity scheduler.js keys skip-checks/re-registration on stays unique —
  // otherwise skipping one schedule silently skips/replaces the wrong one. Shares
  // this file with P1-3 (the blank-label batch-validation fix touches this same
  // validator). On conflict: keep BOTH unless they touch the same lines. Remove
  // note after merge.
  const seenTimeLabel = new Set();
  for (const schedule of schedules) {
    if (!isPlainObject(schedule)) {
      return { valid: false, message: "Invalid schedules_json entry: must be an object" };
    }
    if (!isNonBlankString(schedule.label)) {
      return { valid: false, message: "Invalid schedules_json entry: label must be a non-empty string" };
    }
    if (typeof schedule.time !== "string" || !SCHEDULE_TIME_RE.test(schedule.time)) {
      return { valid: false, message: "Invalid schedules_json entry: time must be HH:MM (24h)" };
    }
    if (typeof schedule.enabled !== "boolean") {
      return { valid: false, message: "Invalid schedules_json entry: enabled must be a boolean" };
    }
    if (schedule.tz !== undefined && !isValidTimeZone(schedule.tz)) {
      return { valid: false, message: "Invalid schedules_json entry: tz must be a valid IANA timezone" };
    }
    if (
      schedule.skipped_until !== undefined
      && (typeof schedule.skipped_until !== "string" || Number.isNaN(Date.parse(schedule.skipped_until)))
    ) {
      return { valid: false, message: "Invalid schedules_json entry: skipped_until must be a date string" };
    }
    const identity = JSON.stringify([schedule.time, schedule.label]);
    if (seenTimeLabel.has(identity)) {
      return { valid: false, message: "Invalid schedules_json: duplicate schedule (same time and label)" };
    }
    seenTimeLabel.add(identity);
  }
  return { valid: true, value: schedules };
}

// Interests are free-text topics matched against email text by the triage
// worker (normalizeEmailInterests trims and drops blanks at read).
export function validateEmailInterests(value) {
  const parsed = parseMaybeJson(value, "email_interests_json");
  if (!parsed.ok) return { valid: false, message: parsed.message };
  const interests = parsed.value;
  if (!Array.isArray(interests)) {
    return { valid: false, message: "Invalid email_interests_json: must be an array" };
  }
  for (const interest of interests) {
    if (!isNonBlankString(interest)) {
      return { valid: false, message: "Invalid email_interests_json entry: must be a non-empty string" };
    }
  }
  return { valid: true, value: interests };
}

export function validateImportantSenders(senders) {
  if (!Array.isArray(senders)) {
    return { valid: false, message: "senders must be an array" };
  }
  const seen = new Set();
  for (const sender of senders) {
    if (!isPlainObject(sender)) {
      return { valid: false, message: "Invalid senders entry: must be an object" };
    }
    if (!isNonBlankString(sender.address) || !sender.address.includes("@")) {
      return { valid: false, message: "Invalid senders entry: address must be an email address" };
    }
    if (sender.name !== undefined && typeof sender.name !== "string") {
      return { valid: false, message: "Invalid senders entry: name must be a string" };
    }
    if (sender.source !== undefined && !IMPORTANT_SENDER_SOURCES.has(sender.source)) {
      return { valid: false, message: "Invalid senders entry: source must be \"manual\" or \"auto\"" };
    }
    const key = sender.address.trim().toLowerCase();
    if (seen.has(key)) {
      return { valid: false, message: `Duplicate sender address: ${key}` };
    }
    seen.add(key);
  }
  return { valid: true, value: senders };
}

const UTILITY_PAY_URL_RE = /^https?:\/\//i;

// Pay-link entries match a bill by stable Actual scheduleId; `url` opens in a new
// tab from BillsDetailRail. `label` is a cached display name for the settings list
// only and is not used for matching.
export function validateUtilityPayLinks(links) {
  if (!Array.isArray(links)) {
    return { valid: false, message: "utility_pay_links must be an array" };
  }
  const seen = new Set();
  const value = [];
  for (const link of links) {
    if (!isPlainObject(link)) {
      return { valid: false, message: "Invalid utility_pay_links entry: must be an object" };
    }
    if (!isNonBlankString(link.scheduleId)) {
      return { valid: false, message: "Invalid utility_pay_links entry: scheduleId must be a non-empty string" };
    }
    const url = typeof link.url === "string" ? link.url.trim() : "";
    if (!UTILITY_PAY_URL_RE.test(url)) {
      return { valid: false, message: "Invalid utility_pay_links entry: url must start with http:// or https://" };
    }
    const scheduleId = link.scheduleId.trim();
    if (seen.has(scheduleId)) {
      return { valid: false, message: `Duplicate utility_pay_links scheduleId: ${scheduleId}` };
    }
    seen.add(scheduleId);
    const label = typeof link.label === "string" ? link.label.trim() : "";
    value.push({ scheduleId, label, url });
  }
  return { valid: true, value };
}
