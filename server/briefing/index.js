import db from "../db/connection.js";
import { decrypt } from "./encryption.js";
import { fetchEmails as fetchGmailEmails } from "./gmail.js";
import { fetchEmails as fetchIcloudEmails } from "./icloud.js";
import { fetchCalendar, getNextWeekRange, getTomorrowRange } from "./calendar.js";
import { fetchWeather } from "./weather.js";
import { fetchCTMDeadlines } from "./ctm.js";
import { fetchTodoistTasks, fetchTodoistTaskIdSet } from "./todoist.js";
import { callClaude } from "./claude.js";
import { getCategories, getUpcomingBills } from "./actual.js";
import { embedAndStore, getContextForBriefing, isEmbeddingAvailable } from "../embeddings/index.js";
import { indexEmails, isIndexEmpty } from "./email-index.js";
import { hydrateRecurringTombstones } from "./tombstones.js";
import { canonicalizeConfiguredAccounts } from "./account-canonical.js";

// Shared: load accounts + settings, return them
export async function loadUserConfig(userId) {
  const accountsResult = await db.execute({
    sql: "SELECT * FROM ea_accounts WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC",
    args: [userId],
  });
  const accounts = canonicalizeConfiguredAccounts(accountsResult.rows);

  const settingsResult = await db.execute({
    sql: "SELECT * FROM ea_settings WHERE user_id = ?",
    args: [userId],
  });
  let settings = settingsResult.rows[0];

  if (!settings) {
    await db.execute({
      sql: "INSERT INTO ea_settings (user_id) VALUES (?)",
      args: [userId],
    });
    const defaultResult = await db.execute({
      sql: "SELECT * FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    settings = defaultResult.rows[0];
  }

  return { accounts, settings };
}

// Compute hours since the last ready briefing (for dynamic email lookback)
async function hoursSinceLastBriefing(userId) {
  const result = await db.execute({
    sql: `SELECT generated_at FROM ea_briefings
          WHERE user_id = ? AND status = 'ready'
          ORDER BY generated_at DESC LIMIT 1`,
    args: [userId],
  });
  if (!result.rows.length) return null;
  const lastTime = new Date(result.rows[0].generated_at + "Z").getTime();
  return (Date.now() - lastTime) / 3600000;
}

// Fetch non-email data sources (calendar, weather, CTM)
async function fetchLiveData(userId, accounts, settings) {
  const gmailAccounts = accounts.filter((a) => a.type === "gmail");
  const calendarAccounts = gmailAccounts.filter((a) => a.calendar_enabled);

  const [calendar, nextWeekCalendar, tomorrowCalendar, weather, ctmDeadlines, todoistTasks, todoistTaskIdSet] = await Promise.all([
    fetchCalendar(calendarAccounts).catch((err) => {
      console.error("Calendar fetch failed:", err.message);
      return [];
    }),
    fetchCalendar(calendarAccounts, getNextWeekRange()).catch((err) => {
      console.error("Next week calendar fetch failed:", err.message);
      return [];
    }),
    fetchCalendar(calendarAccounts, getTomorrowRange()).catch((err) => {
      console.error("Tomorrow calendar fetch failed:", err.message);
      return [];
    }),
    fetchWeather(
      settings.weather_lat || 34.1442,
      settings.weather_lng || -117.9981,
    ).catch((err) => {
      console.error("Weather fetch failed:", err.message);
      return { temp: 0, high: 0, low: 0, summary: "Weather unavailable", hourly: [] };
    }),
    fetchCTMDeadlines(userId).catch((err) => {
      console.error("CTM events fetch failed:", err.message);
      return [];
    }),
    fetchTodoistTasks(userId).catch((err) => {
      console.error("Todoist fetch failed:", err.message);
      return [];
    }),
    // Separate full-horizon probe so tombstone orphan detection doesn't
    // false-positive on weekly/monthly recurrences that advance past +8d.
    // null signals "can't verify" so the hydrator skips pruning.
    fetchTodoistTaskIdSet(userId).catch((err) => {
      console.error("Todoist task id set fetch failed:", err.message);
      return null;
    }),
  ]);

  return { calendar, nextWeekCalendar, tomorrowCalendar, weather, ctmDeadlines, todoistTasks, todoistTaskIdSet };
}

// Fetch emails from all accounts
export async function fetchAllEmails(accounts, hoursBack) {
  const gmailAccounts = accounts.filter((a) => a.type === "gmail");
  const icloudAccounts = accounts.filter((a) => a.type === "icloud");

  const emailPromises = [
    ...gmailAccounts.map((a) =>
      fetchGmailEmails(a, hoursBack).catch((err) => {
        console.error(`Gmail fetch failed for ${a.email}:`, err.message);
        return [];
      }),
    ),
    ...icloudAccounts.map(async (a) => {
      const password = decrypt(a.credentials_encrypted);
      return fetchIcloudEmails(a, password, hoursBack).catch((err) => {
        console.error(`iCloud fetch failed for ${a.email}:`, err.message);
        return [];
      });
    }),
  ];

  const emailArrays = await Promise.all(emailPromises);
  return emailArrays.flat();
}

function nowPacific() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Load todoist IDs from legacy dedupe rows (due_date IS NULL) only.
// Tombstone rows (due_date IS NOT NULL) are handled separately by
// hydrateRecurringTombstones and must not participate in the Todoist
// suppression filter, or the live next-occurrence row would be dropped.
// Reconciliation (un-complete in Todoist → reappears in the API) also
// scopes to legacy rows so tombstones survive.
export async function loadCompletedTaskIds(userId, todoistTasks) {
  const result = await db.execute({
    sql: "SELECT todoist_id FROM ea_completed_tasks WHERE user_id = ? AND due_date IS NULL",
    args: [userId],
  });
  const completedIds = new Set(result.rows.map(r => r.todoist_id));

  if (todoistTasks?.length && completedIds.size) {
    const reopened = todoistTasks.filter(t => completedIds.has(t.id)).map(t => t.id);
    if (reopened.length) {
      console.log(`[Briefing] Reconciling ${reopened.length} un-completed Todoist task(s)`);
      await db.execute({
        sql: `DELETE FROM ea_completed_tasks WHERE user_id = ? AND due_date IS NULL AND todoist_id IN (${reopened.map(() => "?").join(",")})`,
        args: [userId, ...reopened],
      });
      for (const id of reopened) completedIds.delete(id);
    }
  }

  return completedIds;
}

// Separate CTM and Todoist tasks, deduplicating by todoist_id (CTM wins).
// CTM is the source of truth for completion (the API now returns complete
// tasks too), so completedIds only filter Todoist — Todoist's API doesn't
// return completed tasks, but ea_completed_tasks remembers in-app completions
// so we can drop a CTM-linked task that was completed via Todoist mirror.
export function separateDeadlines(ctmDeadlines, todoistTasks, completedIds) {
  // CTM items with a todoist_id suppress the matching Todoist task
  const ctmTodoistIds = new Set(ctmDeadlines.filter(d => d.todoist_id).map(d => d.todoist_id));
  const uniqueTodoist = todoistTasks.filter(t => !ctmTodoistIds.has(t.id));

  const ctm = ctmDeadlines;
  let todoist = uniqueTodoist;

  if (completedIds?.size) {
    todoist = todoist.filter(t => !completedIds.has(t.id));
  }

  return { ctm, todoist };
}

// Preserve completed non-recurring Todoist rows across a rebuild.
//
// Todoist's API doesn't return closed tasks, so without this step a refresh
// would wipe any task the user marked complete since the last briefing.
// Recurring completions are already handled by the tombstone path (they'd
// carry `_tombstone: true` and we skip those here to avoid duplicating).
//
// Gate:
//   - boundary = "today"     → deadlines section (default)
//   - boundary = "yesterday" → calendar view (shows one extra day back)
export function carryForwardCompletedTodoist(newList, prevList, boundary) {
  if (!prevList?.length) return newList;
  const keyOf = (t) => `${t.id}:${t.due_date}`;
  const keys = new Set(newList.map(keyOf));
  const carried = [];
  for (const t of prevList) {
    if (t.status !== "complete" || t._tombstone) continue;
    if (!t.due_date || t.due_date < boundary) continue;
    const k = keyOf(t);
    if (keys.has(k)) continue;
    carried.push(t);
    keys.add(k);
  }
  return carried.length ? [...newList, ...carried] : newList;
}

// Compute stats from a deadlines array (works for both CTM and Todoist)
export function computeDeadlineStats(deadlines) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });
  const today = fmt.format(new Date());
  const weekFromNow = fmt.format(new Date(Date.now() + 7 * 86400000));
  let totalPoints = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let incomplete = 0;

  for (const d of deadlines) {
    if (d.status !== "complete") incomplete++;
    if (d.due_date === today) dueToday++;
    if (d.due_date >= today && d.due_date <= weekFromNow) dueThisWeek++;
    if (d.points_possible) totalPoints += d.points_possible;
  }

  return { incomplete, dueToday, dueThisWeek, totalPoints };
}

function countUnreadEmails(emails = []) {
  return emails.filter((email) => !email.read).length;
}

// Fix email accounts: re-group triaged emails by their original account_label,
// correct unread counts, and ensure no emails land in the wrong account.
// dbAccounts (optional): all configured ea_accounts rows — seeds tabs for accounts with 0 emails.
export function fixEmailAccounts(briefingJson, inputEmails, dbAccounts) {
  if (!briefingJson.emails) briefingJson.emails = { summary: "", accounts: [] };
  if (!briefingJson.emails.accounts) briefingJson.emails.accounts = [];

  // Seed grouped map with every configured email account so 0-email accounts keep their tab
  const grouped = new Map();
  if (dbAccounts) {
    for (const a of dbAccounts) {
      if (a.type !== "gmail" && a.type !== "icloud") continue;
      const label = a.label;
      if (!label || grouped.has(label)) continue;
      grouped.set(label, {
        name: label,
        icon: a.icon || (a.type === "icloud" ? "Apple" : "Mail"),
        color: a.color || "#6366f1",
        important: [],
        noise: [],
        noise_count: 0,
      });
    }
  }

  if (!inputEmails?.length) {
    // No emails fetched — keep seeded empty accounts
    briefingJson.emails.accounts = [...grouped.values()].map((acct) => ({
      ...acct,
      unread: 0,
    }));
    return;
  }

  // Build lookup: email uid/id → original account info (including current read status)
  const emailLookup = new Map();
  for (const e of inputEmails) {
    emailLookup.set(e.uid, {
      label: e.account_label,
      icon: e.account_icon,
      color: e.account_color,
      message_id: e.message_id,
      read: e.read,
    });
  }

  // Collect all triaged emails from Claude's response, tag with correct account
  const allTriaged = [];
  for (const acct of briefingJson.emails.accounts) {
    for (const email of acct.important || []) {
      const id = email.id || email.uid;
      const original = emailLookup.get(id);
      if (original?.message_id) email.message_id = original.message_id;
      if (typeof original?.read === "boolean") email.read = original.read;
      allTriaged.push({ email, accountLabel: original?.label || acct.name });
    }
  }

  // Re-group by correct account label (into the pre-seeded map)
  for (const { email, accountLabel } of allTriaged) {
    if (!grouped.has(accountLabel)) {
      const original = inputEmails.find((e) => e.account_label === accountLabel);
      grouped.set(accountLabel, {
        name: accountLabel,
        icon: original?.account_icon || "Mail",
        color: original?.account_color || "#6366f1",
        important: [],
        noise: [],
        noise_count: 0,
      });
    }
    grouped.get(accountLabel).important.push(email);
  }

  // Preserve noise emails and noise_count from Claude's response.
  // Drop any noise entry whose id is already in important — Claude occasionally
  // returns the same email in both arrays, which renders as duplicate rows
  // (one per lane) sharing a key, breaking selection and reconciliation.
  const allImportantIds = new Set();
  for (const g of grouped.values()) {
    for (const e of g.important) {
      const id = e.id || e.uid;
      if (id) allImportantIds.add(id);
    }
  }
  for (const acct of briefingJson.emails.accounts) {
    const g = grouped.get(acct.name);
    if (!g) continue;
    if (acct.noise_count) g.noise_count = acct.noise_count;
    for (const n of acct.noise || []) {
      const nid = n.id || n.uid;
      if (nid && allImportantIds.has(nid)) continue;
      const original = emailLookup.get(nid);
      if (original?.message_id) n.message_id = original.message_id;
      if (typeof original?.read === "boolean") n.read = original.read;
      g.noise.push(n);
    }
  }

  // Replace accounts with corrected grouping, fix unread counts
  briefingJson.emails.accounts = [...grouped.values()].map((acct) => ({
    ...acct,
    unread: countUnreadEmails(acct.important),
  }));

  // Invariant check: email count in should equal email count out (per D-01, D-02)
  const countIn = allTriaged.length;
  const countOut = briefingJson.emails.accounts.reduce(
    (sum, acct) => sum + acct.important.length, 0
  );
  if (countIn !== countOut) {
    console.warn(
      `[Briefing] Email count mismatch in fixEmailAccounts: ${countIn} in, ${countOut} out`
    );
  }
}

// Known payment processors whose confirmation emails duplicate the merchant's own receipt
const PAYMENT_PROCESSORS = new Set([
  "paypal", "venmo", "zelle", "cash app", "apple pay", "google pay", "square",
]);

// Deduplicate extracted bills across all email accounts.
// When a payment processor (PayPal, Venmo, etc.) and a merchant both report the same
// transaction (same amount + date within 1 day), clear the bill from the processor email.
export function deduplicateBills(briefingJson) {
  const accounts = briefingJson?.emails?.accounts;
  if (!accounts?.length) return;

  // Collect all emails with bills into a flat list with back-references
  const billEmails = [];
  for (const acct of accounts) {
    for (const email of acct.important || []) {
      if (email.hasBill && email.extractedBill && email.extractedBill.amount > 0) {
        billEmails.push(email);
      }
    }
  }

  if (billEmails.length < 2) return;

  // Find duplicates: same amount, dates within 1 day, one is a payment processor
  const dominated = new Set();
  for (let i = 0; i < billEmails.length; i++) {
    if (dominated.has(i)) continue;
    for (let j = i + 1; j < billEmails.length; j++) {
      if (dominated.has(j)) continue;
      const a = billEmails[i];
      const b = billEmails[j];
      if (a.extractedBill.amount !== b.extractedBill.amount) continue;

      // Check dates are within 1 day of each other
      const dateA = new Date(a.extractedBill.due_date);
      const dateB = new Date(b.extractedBill.due_date);
      if (Math.abs(dateA - dateB) > 86400000) continue;

      // Determine which is the payment processor
      const aFrom = (a.from || "").toLowerCase();
      const bFrom = (b.from || "").toLowerCase();
      const aIsProcessor = [...PAYMENT_PROCESSORS].some(p => aFrom.includes(p));
      const bIsProcessor = [...PAYMENT_PROCESSORS].some(p => bFrom.includes(p));

      if (aIsProcessor && !bIsProcessor) dominated.add(i);
      else if (bIsProcessor && !aIsProcessor) dominated.add(j);
    }
  }

  // Clear bills from dominated (processor) emails
  for (const idx of dominated) {
    billEmails[idx].hasBill = false;
    billEmails[idx].extractedBill = null;
  }

  if (dominated.size > 0) {
    console.log(`[Briefing] Deduplicated ${dominated.size} duplicate bill(s) from payment processor emails`);
  }
}

// Load dismissed email IDs for this user
async function loadDismissedIds(userId) {
  const result = await db.execute({
    sql: "SELECT email_id FROM ea_dismissed_emails WHERE user_id = ?",
    args: [userId],
  });
  return new Set(result.rows.map(r => r.email_id));
}

// Load pinned email IDs for this user
async function loadPinnedIds(userId) {
  const result = await db.execute({
    sql: "SELECT email_id FROM ea_pinned_emails WHERE user_id = ?",
    args: [userId],
  });
  return new Set(result.rows.map(r => r.email_id));
}

// Load previously triaged email IDs from the last ready briefing
async function loadPreviousTriage(userId) {
  const [result, dismissedIds, pinnedIds] = await Promise.all([
    db.execute({
      sql: `SELECT briefing_json FROM ea_briefings
            WHERE user_id = ? AND status = 'ready' AND briefing_json LIKE '%aiGeneratedAt%'
            ORDER BY generated_at DESC LIMIT 1`,
      args: [userId],
    }),
    loadDismissedIds(userId),
    loadPinnedIds(userId),
  ]);
  if (!result.rows.length) return { triagedIds: new Set(), prevBriefing: null, dismissedIds, pinnedIds };

  const prev = JSON.parse(result.rows[0].briefing_json);
  const triagedIds = new Set();
  for (const acct of prev.emails?.accounts || []) {
    for (const email of acct.important || []) {
      if (email.id) triagedIds.add(email.id);
    }
  }
  return { triagedIds, prevBriefing: prev, dismissedIds, pinnedIds };
}

// Check if calendar data has meaningfully changed (CTM doesn't go to Haiku)
function hasCalendarChanged(prev, currentCalendar) {
  return JSON.stringify(prev.calendar || []) !== JSON.stringify(currentCalendar || []);
}

// Pure function: merge delta triage results with previous briefing triage.
// Takes (prevBriefing, newBriefing, dismissedIds, allEmailIds) and returns merged accounts array.
// The DB call (loadDismissedIds) stays in generateBriefing.
export function mergeDeltaBriefing(prevBriefing, newBriefing, dismissedIds, allEmailIds) {
  // Clone new accounts to avoid mutating input; tag all new emails with seenCount 1
  const mergedAccounts = (newBriefing?.emails?.accounts || []).map(acct => ({
    ...acct,
    important: acct.important.map(e => ({ ...e, seenCount: 1 })),
  }));

  const newByAccount = new Map();
  for (const acct of mergedAccounts) {
    newByAccount.set(acct.name, acct);
  }

  for (const prevAcct of prevBriefing?.emails?.accounts || []) {
    const newAcct = newByAccount.get(prevAcct.name);
    if (newAcct) {
      // Merge: old emails that still exist in inbox, not dismissed, not expired
      const existingIds = new Set(newAcct.important.map(e => e.id));
      const keptOld = prevAcct.important
        .filter(e => !existingIds.has(e.id) && allEmailIds.has(e.id) && !dismissedIds.has(e.id) && (e.seenCount || 1) < 3)
        .map(e => ({ ...e, seenCount: (e.seenCount || 1) + 1 }));
      newAcct.important = [...keptOld, ...newAcct.important];
      newAcct.unread = countUnreadEmails(newAcct.important);
      newAcct.noise_count = (prevAcct.noise_count || 0) + (newAcct.noise_count || 0);
    } else {
      // Account had no new emails — carry forward previous triage
      const stillRelevant = prevAcct.important
        .filter(e => allEmailIds.has(e.id) && !dismissedIds.has(e.id) && (e.seenCount || 1) < 3)
        .map(e => ({ ...e, seenCount: (e.seenCount || 1) + 1 }));
      if (stillRelevant.length > 0 || prevAcct.noise_count > 0) {
        mergedAccounts.push({
          ...prevAcct,
          important: stillRelevant,
          unread: countUnreadEmails(stillRelevant),
        });
      }
    }
  }

  // Ensure unread reflects only unread important emails on every account
  for (const acct of mergedAccounts) {
    acct.unread = countUnreadEmails(acct.important);
  }

  // Invariant check: total emails out should not exceed total emails in
  const totalIn = (newBriefing?.emails?.accounts || []).reduce((s, a) => s + a.important.length, 0)
    + (prevBriefing?.emails?.accounts || []).reduce((s, a) => s + a.important.length, 0);
  const totalOut = mergedAccounts.reduce((s, a) => s + a.important.length, 0);
  if (totalOut > totalIn) {
    console.warn(
      `[Briefing] Delta merge email count anomaly: ${totalIn} in, ${totalOut} out`
    );
  }

  return mergedAccounts;
}

// Full generation: fetch data + Haiku AI analysis (with delta optimization)
async function updateProgress(briefingId, progress) {
  await db.execute({
    sql: `UPDATE ea_briefings SET progress = ? WHERE id = ?`,
    args: [progress, briefingId],
  });
}

export async function generateBriefing(userId, { scheduleLabel } = {}) {
  const insertResult = await db.execute({
    sql: `INSERT INTO ea_briefings (user_id, status, progress) VALUES (?, 'generating', 'Loading settings...')`,
    args: [userId],
  });
  const briefingId = Number(insertResult.lastInsertRowid);
  const startTime = Date.now();

  try {
    const { accounts, settings } = await loadUserConfig(userId);

    // Dynamic lookback: cover time since last briefing, minimum 16h floor, hard cap at 24h
    const sinceLastHours = await hoursSinceLastBriefing(userId);
    const minLookback = settings.email_lookback_hours || 16;
    const maxLookback = 24;
    const hoursBack = sinceLastHours != null
      ? Math.min(Math.max(Math.ceil(sinceLastHours) + 1, minLookback), maxLookback)
      : minLookback;

    const emailCount = accounts.filter(a => a.type === "gmail" || a.type === "icloud").length;
    await updateProgress(briefingId, `Fetching emails from ${emailCount} account${emailCount !== 1 ? "s" : ""}...`);

    const [{ calendar, nextWeekCalendar, tomorrowCalendar, weather, ctmDeadlines, todoistTasks, todoistTaskIdSet }, emails, { triagedIds, prevBriefing, dismissedIds, pinnedIds }] = await Promise.all([
      fetchLiveData(userId, accounts, settings),
      fetchAllEmails(accounts, hoursBack),
      loadPreviousTriage(userId),
    ]);

    // index all fetched emails (read + unread) for keyword search
    const indexEmpty = await isIndexEmpty(userId);
    indexEmails(userId, emails).catch(err =>
      console.error("[EA] Email indexing failed:", err.message)
    );
    if (indexEmpty) {
      // one-time backfill: fetch 90 days of email metadata
      console.log("[EA] Email index empty — starting 90-day backfill...");
      fetchAllEmails(accounts, 2160)
        .then(allEmails => indexEmails(userId, allEmails))
        .then(() => console.log("[EA] Backfill complete"))
        .catch(err => console.error("[EA] Backfill indexing failed:", err.message));
    }

    // Reconcile after Todoist tasks are available (un-completed tasks get removed from table)
    const completedTaskIds = await loadCompletedTaskIds(userId, todoistTasks);

    // Optimization #2: Skip if nothing new (also exclude dismissed emails)
    // Pinned emails bypass triaged filter and are treated as unread for Claude
    const newEmails = emails.filter(e => {
      const eid = e.id || e.uid;
      if (pinnedIds.has(eid)) return true;
      return !triagedIds.has(eid) && !dismissedIds.has(eid);
    });
    const unreadNew = newEmails.filter(e => !e.read || pinnedIds.has(e.id || e.uid));
    const calendarChanged = prevBriefing ? hasCalendarChanged(prevBriefing, calendar) : true;

    await updateProgress(briefingId, `Fetched ${emails.length} email${emails.length !== 1 ? "s" : ""}, ${unreadNew.length} unread new · Analyzing...`);

    // Force AI if last call was >16h ago (prevents perpetual skips for clean-inbox users)
    const aiStale = !prevBriefing?.aiGeneratedAt ||
      (Date.now() - new Date(prevBriefing.aiGeneratedAt).getTime()) > 16 * 60 * 60 * 1000;

    if (unreadNew.length === 0 && !calendarChanged && prevBriefing && !aiStale) {
      await updateProgress(briefingId, "No new data — refreshing weather and deadlines...");
      console.log("[EA] No new emails or data changes — cloning previous briefing with fresh weather");
      const cloned = { ...prevBriefing };
      cloned.weather = { ...weather, location: settings.weather_location || "El Monte, CA" };
      const separated = separateDeadlines(ctmDeadlines, todoistTasks, completedTaskIds);
      const tombstones = await hydrateRecurringTombstones(userId, todoistTaskIdSet);
      const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
      const withCarried = carryForwardCompletedTodoist(
        [...separated.todoist, ...tombstones],
        prevBriefing?.todoist?.upcoming,
        todayStr,
      );
      cloned.ctm = { upcoming: separated.ctm, stats: computeDeadlineStats(separated.ctm) };
      cloned.todoist = { upcoming: withCarried, stats: computeDeadlineStats(withCarried) };
      // Increment seenCount and filter dismissed/expired emails on clone
      for (const acct of cloned.emails?.accounts || []) {
        acct.important = acct.important
          .filter(e => !dismissedIds.has(e.id) && (e.seenCount || 1) < 3)
          .map(e => ({ ...e, seenCount: (e.seenCount || 1) + 1 }));
        acct.unread = countUnreadEmails(acct.important);
      }
      // Guard against fixEmailAccounts' empty-inputs branch, which resets
      // accounts to zero-email seeded entries. That's correct for full-gen
      // (Claude hallucinating triage from no inputs) but wrong here —
      // cloned already holds carry-forward emails, and a quiet fresh fetch
      // must not wipe them.
      if (emails.length) fixEmailAccounts(cloned, emails, accounts);
      deduplicateBills(cloned);
      cloned.nextWeekCalendar = nextWeekCalendar;
      cloned.tomorrowCalendar = tomorrowCalendar;
      cloned.dataUpdatedAt = new Date().toISOString();
      cloned.generatedAt = nowPacific();
      if (scheduleLabel) cloned.scheduleLabel = scheduleLabel;
      // Keep previous aiGeneratedAt to indicate AI didn't re-run
      cloned.skippedAI = true;
      cloned.nonAiGenerationCount = (prevBriefing.nonAiGenerationCount || 0) + 1;

      const elapsed = Date.now() - startTime;
      await db.execute({
        sql: `UPDATE ea_briefings SET status = 'ready', briefing_json = ?, generation_time_ms = ? WHERE id = ?`,
        args: [JSON.stringify(cloned), elapsed, briefingId],
      });
      return { id: briefingId, briefingJson: cloned, skippedAI: true };
    }

    // Optimization #1: Delta-only generation — only send new emails to Claude,
    // merge results with previous triage
    const model = settings.claude_model || undefined;
    const emailInterests = settings.email_interests_json ? JSON.parse(settings.email_interests_json) : [];

    // RAG: retrieve historical context from past briefing embeddings
    let historicalContext = null;
    if (isEmbeddingAvailable()) {
      try {
        historicalContext = await getContextForBriefing(userId);
        if (historicalContext) console.log(`[EA] Injecting historical context (${historicalContext.length} chars)`);
      } catch (err) {
        console.warn("[EA] Historical context retrieval failed:", err.message);
      }
    } else {
      console.warn("[EA] OPENAI_API_KEY not set — briefing will lack historical context");
    }

    // Lazy-load Actual Budget data — only needed when Claude runs (avoids 20k+ CRDT sync on clone path)
    const [categories, upcomingBills] = await Promise.all([
      getCategories(userId).catch((err) => {
        console.error("Actual Budget categories fetch failed:", err.message);
        return [];
      }),
      getUpcomingBills(userId).catch((err) => {
        console.error("Actual Budget upcoming bills fetch failed:", err.message);
        return [];
      }),
    ]);

    let briefingJson;
    if (unreadNew.length > 0 && unreadNew.length < emails.length && prevBriefing) {
      await updateProgress(briefingId, `Sending ${unreadNew.length} new email${unreadNew.length !== 1 ? "s" : ""} to ${model || "Claude"}...`);
      console.log(`[EA] Delta generation: ${unreadNew.length} new unread emails (${emails.length - newEmails.length} previously triaged)`);
      briefingJson = await callClaude({ emails: unreadNew, calendar, ctmDeadlines, todoistTasks, model, emailInterests, categories, historicalContext, upcomingBills, nextWeekCalendar });

      // Merge previous triage with new triage using pure function
      const allEmailIds = new Set(emails.map(e => e.id || e.uid));
      const mergedAccounts = mergeDeltaBriefing(prevBriefing, briefingJson, dismissedIds, allEmailIds);
      briefingJson.emails.accounts = mergedAccounts;
    } else {
      // Full generation: all emails are new or no previous triage
      const emailsForClaude = unreadNew.length > 0 ? unreadNew : emails;
      await updateProgress(briefingId, `Sending ${emailsForClaude.length} email${emailsForClaude.length !== 1 ? "s" : ""} to ${model || "Claude"}...`);
      console.log(`[EA] Full generation: ${emailsForClaude.length} emails`);
      briefingJson = await callClaude({ emails: emailsForClaude, calendar, ctmDeadlines, todoistTasks, model, emailInterests, categories, historicalContext, upcomingBills, nextWeekCalendar });
      // Tag all emails with seenCount 1
      for (const acct of briefingJson.emails?.accounts || []) {
        acct.important = acct.important.map(e => ({ ...e, seenCount: 1 }));
      }
    }

    // Reattach fields from original emails — Claude only sees/returns `id`, but the
    // frontend needs uid (for body fetching) and account_id/account_email (for the
    // direct Gmail web link).
    const origById = new Map(emails.map(e => [e.id || e.uid, e]));
    function reattach(e) {
      const orig = origById.get(e.id);
      if (!orig) return;
      if (!e.uid) e.uid = orig.uid;
      if (!e.account_id) e.account_id = orig.account_id;
      if (!e.account_email) e.account_email = orig.account_email;
      if (!e.message_id && orig.message_id) e.message_id = orig.message_id;
      if (typeof orig.read === "boolean") e.read = orig.read;
    }
    for (const acct of briefingJson.emails?.accounts || []) {
      for (const e of acct.important) reattach(e);
      for (const e of acct.noise || []) reattach(e);
    }

    await updateProgress(briefingId, "Finalizing briefing...");

    // Always overwrite deadline data with server-fetched values (Claude may hallucinate these)
    const separated = separateDeadlines(ctmDeadlines, todoistTasks, completedTaskIds);
    const tombstones = await hydrateRecurringTombstones(userId, todoistTaskIdSet);
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    const todoistAfterCarry = carryForwardCompletedTodoist(
      [...separated.todoist, ...tombstones],
      prevBriefing?.todoist?.upcoming,
      todayStr,
    );
    briefingJson.ctm = {
      upcoming: separated.ctm,
      stats: computeDeadlineStats(separated.ctm),
    };
    briefingJson.todoist = {
      upcoming: todoistAfterCarry,
      stats: computeDeadlineStats(todoistAfterCarry),
    };

    // Server owns all deadline data (CTM, Todoist) — discard any Claude output
    delete briefingJson.deadlines;

    // Overwrite calendar with server-fetched data (has accurate `passed` flags)
    briefingJson.calendar = calendar;
    briefingJson.nextWeekCalendar = nextWeekCalendar;
    briefingJson.tomorrowCalendar = tomorrowCalendar;

    // Fix email account grouping: re-assign emails to correct accounts based on
    // the original account_label from the fetched data (Claude sometimes misgroups)
    fixEmailAccounts(briefingJson, emails, accounts);
    deduplicateBills(briefingJson);

    // Set server-fetched weather (Claude no longer returns this)
    briefingJson.weather = { ...weather, location: settings.weather_location || "El Monte, CA" };

    briefingJson.generatedAt = nowPacific();
    briefingJson.dataUpdatedAt = new Date().toISOString();
    briefingJson.aiGeneratedAt = new Date().toISOString();
    briefingJson.nonAiGenerationCount = 0;
    if (scheduleLabel) briefingJson.scheduleLabel = scheduleLabel;
    if (!isEmbeddingAvailable()) briefingJson.ragUnavailable = true;

    const elapsed = Date.now() - startTime;
    await db.execute({
      sql: `UPDATE ea_briefings SET status = 'ready', briefing_json = ?, generation_time_ms = ? WHERE id = ?`,
      args: [JSON.stringify(briefingJson), elapsed, briefingId],
    });

    // Pins are now sticky (kept visible across briefings + bias the next
    // triage). We intentionally do not clear them here — the user manages
    // pin/unpin explicitly, and trashing an email clears its pin server-side.

    // Async: embed this briefing's chunks for future RAG (fire-and-forget)
    const sourceDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    embedAndStore({ userId, briefingId, briefingJson, sourceDate }).catch(err => {
      console.warn(`[EA] Embedding failed for briefing ${briefingId}:`, err.message);
    });

    return { id: briefingId, briefingJson };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    await db.execute({
      sql: `UPDATE ea_briefings SET status = 'error', error_message = ?, generation_time_ms = ? WHERE id = ?`,
      args: [error.message, elapsed, briefingId],
    });
    throw error;
  }
}

// Quick refresh: update calendar, weather, CTM only — emails left to full generation
export async function quickRefresh(userId) {
  const { accounts, settings } = await loadUserConfig(userId);
  const { calendar, nextWeekCalendar, tomorrowCalendar, weather, ctmDeadlines, todoistTasks, todoistTaskIdSet } = await fetchLiveData(userId, accounts, settings);
  const completedTaskIds = await loadCompletedTaskIds(userId, todoistTasks);

  // Load the latest ready briefing to patch into
  const latestResult = await db.execute({
    sql: `SELECT id, briefing_json FROM ea_briefings
          WHERE user_id = ? AND status = 'ready'
          ORDER BY generated_at DESC LIMIT 1`,
    args: [userId],
  });

  let briefing;
  if (latestResult.rows.length) {
    briefing = JSON.parse(latestResult.rows[0].briefing_json);
  } else {
    briefing = {
      aiInsights: [],
      emails: { summary: "", accounts: [] },
    };
  }

  // Snapshot the previous Todoist list before overwriting — needed for
  // carry-forward of completed rows that Todoist no longer returns.
  const prevTodoistList = briefing.todoist?.upcoming;

  // Overwrite live data fields, keep emails and AI fields untouched
  briefing.weather = { ...weather, location: settings.weather_location || "El Monte, CA" };
  briefing.calendar = calendar;
  briefing.nextWeekCalendar = nextWeekCalendar;
  briefing.tomorrowCalendar = tomorrowCalendar;
  const separated = separateDeadlines(ctmDeadlines, todoistTasks, completedTaskIds);
  const tombstones = await hydrateRecurringTombstones(userId, todoistTaskIdSet);
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  const todoistAfterCarry = carryForwardCompletedTodoist(
    [...separated.todoist, ...tombstones],
    prevTodoistList,
    todayStr,
  );
  briefing.ctm = {
    upcoming: separated.ctm,
    stats: computeDeadlineStats(separated.ctm),
  };
  briefing.todoist = {
    upcoming: todoistAfterCarry,
    stats: computeDeadlineStats(todoistAfterCarry),
  };
  briefing.dataUpdatedAt = new Date().toISOString();

  // Update the existing briefing row in-place
  if (latestResult.rows.length) {
    await db.execute({
      sql: `UPDATE ea_briefings SET briefing_json = ? WHERE id = ?`,
      args: [JSON.stringify(briefing), latestResult.rows[0].id],
    });
    return { id: latestResult.rows[0].id, briefingJson: briefing, refreshType: "quick" };
  } else {
    const insertResult = await db.execute({
      sql: `INSERT INTO ea_briefings (user_id, status, briefing_json) VALUES (?, 'ready', ?)`,
      args: [userId, JSON.stringify(briefing)],
    });
    return {
      id: Number(insertResult.lastInsertRowid),
      briefingJson: briefing,
      refreshType: "quick",
    };
  }
}
