import { Router } from "express";
import db from "../db/connection.js";
import { requireCookieSession } from "../middleware/auth.js";
import { loadUserConfig } from "../briefing/index.js";
import { fetchEmails as fetchGmailEmails, isMessageRead as isGmailMessageRead } from "../briefing/gmail.js";
import { fetchEmails as fetchIcloudEmails, isMessageRead as isIcloudMessageRead } from "../briefing/icloud.js";
import { fetchCalendar, getNextWeekRange, getTomorrowRange } from "../briefing/calendar.js";
import { fetchWeather } from "../briefing/weather.js";
import { getUpcomingBills, getRecentTransactions, getMetadata as getActualMetadata, isSchedulePaid } from "../briefing/actual.js";
import { decrypt } from "../briefing/encryption.js";
import { getTodoistSyncHealth } from "../briefing/todoist.js";
import { getElapsedMs, logTiming, timeRoute } from "../timing.js";

const router = Router();
router.use(timeRoute("/api/live/all"));
router.use(requireCookieSession);

const LIVE_TIMEOUT_DEFAULTS_MS = {
  gmailEmail: 10_000,
  icloudEmail: 10_000,
  calendarCurrent: 10_000,
  calendarNextWeek: 10_000,
  calendarTomorrow: 10_000,
  weather: 4_000,
  actualBills: 12_000,
  actualRecentTransactions: 12_000,
  actualMetadata: 12_000,
  resurfacedReadState: 8_000,
};

function extractEmailAddress(from) {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : from.toLowerCase().trim();
}

function timeoutEnvName(source) {
  return `EA_LIVE_TIMEOUT_${source.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_MS`;
}

function getLiveTimeoutMs(source) {
  const raw = process.env[timeoutEnvName(source)];
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : LIVE_TIMEOUT_DEFAULTS_MS[source];
}

async function timeLiveWork(source, work, { degradedSources = null, fallback, timeoutMs = getLiveTimeoutMs(source) } = {}) {
  const startedAt = performance.now();
  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      const degraded = { source, reason: "timeout", timeoutMs };
      degradedSources?.push(degraded);
      logTiming({
        event: "live-source",
        source,
        ms: getElapsedMs(startedAt),
        status: "timeout",
        timeoutMs,
        degraded: true,
      });
      resolve(fallback);
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    const result = await Promise.race([work(), timeoutPromise]);
    if (timer) clearTimeout(timer);
    if (result !== fallback) {
      logTiming({
        event: "live-source",
        source,
        ms: getElapsedMs(startedAt),
        status: "ok",
      });
    }
    return result;
  } catch (err) {
    if (timer) clearTimeout(timer);
    degradedSources?.push({ source, reason: "error", error: err.message });
    logTiming({
      event: "live-source",
      source,
      ms: getElapsedMs(startedAt),
      status: "error",
      error: err.message,
      degraded: true,
    }, console.error);
    return fallback;
  }
}

async function timeLiveRequired(source, work) {
  const startedAt = performance.now();
  try {
    const result = await work();
    logTiming({
      event: "live-source",
      source,
      ms: getElapsedMs(startedAt),
      status: "ok",
    });
    return result;
  } catch (err) {
    logTiming({
      event: "live-source",
      source,
      ms: getElapsedMs(startedAt),
      status: "error",
      error: err.message,
    }, console.error);
    throw err;
  }
}

function skippedLiveSource(source, fallback, reason) {
  logTiming({
    event: "live-source",
    source,
    ms: 0,
    status: "skipped",
    reason,
  });
  return Promise.resolve(fallback);
}

function weatherFallback() {
  return { temp: 0, high: 0, low: 0, summary: "Weather unavailable", hourly: [] };
}

function unavailableTodoistHealth(err) {
  return {
    state: "unavailable",
    configured: null,
    lastSuccessAt: null,
    lastError: err?.message || "Todoist sync health unavailable",
    syncStartedAt: null,
    ageMs: null,
  };
}

// GET /api/live/all — combined live data endpoint
router.get("/all", async (_req, res) => {
  const userId = process.env.EA_USER_ID;

  try {
    const degradedSources = [];
    const { accounts, settings } = await timeLiveRequired(
      "config",
      () => loadUserConfig(userId),
    );
    const briefingGeneratedAt = null;
    const briefingReadStatus = {};
    const hoursBack = 12;

    // Build important senders list (manual only) + load active snoozes.
    // Snapshots travel with snoozes so the inbox can expose "waking"
    // snoozes without waiting for the next snapshot refresh.
    const nowTs = Date.now();
    const [manualSendersRaw, snoozedResult, resurfacedResult] = await timeLiveRequired(
      "snoozeDb",
      () => Promise.all([
        Promise.resolve(settings.important_senders_json),
        db.execute({
          sql: "SELECT email_id, until_ts, email_snapshot FROM ea_snoozed_emails WHERE user_id = ? AND status = 'snoozed' AND until_ts > ?",
          args: [userId, nowTs],
        }),
        // Resurfaced = snooze woke up and the email is supposed to reappear as a
        // fresh live/untriaged email. These rows live 48h (see snooze-waker TTL)
        // before being cleaned up, which is why we pull all of them here — the
        // cleanup cron bounds the set size, not a time filter in this query.
        db.execute({
          sql: "SELECT email_id, resurfaced_at, email_snapshot FROM ea_snoozed_emails WHERE user_id = ? AND status = 'resurfaced'",
          args: [userId],
        }),
      ]),
    );
    const parseSnapshot = (raw) => {
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    };
    const snoozedEntries = snoozedResult.rows.map(r => ({
      uid: r.email_id,
      until_ts: Number(r.until_ts),
      snapshot: parseSnapshot(r.email_snapshot),
    }));
    const resurfacedEntries = resurfacedResult.rows
      .map(r => ({
        uid: r.email_id,
        resurfaced_at: Number(r.resurfaced_at),
        snapshot: parseSnapshot(r.email_snapshot),
      }))
      .filter(r => r.snapshot); // drop rows missing a snapshot — nothing to render

    let manualSenders = [];
    try {
      manualSenders = JSON.parse(manualSendersRaw || "[]");
    } catch {
      manualSenders = [];
    }

    // Merge: manual entries override auto
    const importantSendersMap = new Map();
    for (const sender of manualSenders) {
      importantSendersMap.set(sender.address.toLowerCase(), { ...sender, source: "manual" });
    }
    const importantSenderAddresses = new Set(importantSendersMap.keys());

    // Fetch all data in parallel
    const gmailAccounts = accounts.filter(a => a.type === "gmail");
    const icloudAccounts = accounts.filter(a => a.type === "icloud");
    const calendarAccounts = gmailAccounts.filter(a => a.calendar_enabled);
    const icloudPasswords = new Map(
      icloudAccounts.map((account) => [account.id, decrypt(account.credentials_encrypted)]),
    );
    const findProviderAccount = (providerAccounts, ref) =>
      providerAccounts.find(
        (account) =>
          account.id === ref?.account_id
          || account.email === ref?.account_email
          || account.label === ref?.account_label,
      ) || null;

    // Re-query provider read state for resurfaced rows so they reflect the
    // user's current mailbox state even if they changed the email outside the
    // dashboard. Runs in parallel with email fetches; `null` means "probe
    // failed, fall back to the snapshot's own read bit".
    const resurfacedReadStatePromise = timeLiveWork(
      "resurfacedReadState",
      () => Promise.all(
        resurfacedEntries.map(async (entry) => {
          const snap = entry.snapshot;
          if (entry.uid?.startsWith("gmail-")) {
            const acct = findProviderAccount(gmailAccounts, snap);
            if (!acct) return null;
            return isGmailMessageRead(acct, entry.uid);
          }
          if (entry.uid?.startsWith("icloud-")) {
            const acct = findProviderAccount(icloudAccounts, snap);
            if (!acct) return null;
            return isIcloudMessageRead(acct.email, icloudPasswords.get(acct.id), entry.uid);
          }
          return null;
        }),
      ),
      { degradedSources, fallback: resurfacedEntries.map(() => null) },
    );

    const emailPromises = [
      ...gmailAccounts.map(a =>
        timeLiveWork("gmailEmail", () => fetchGmailEmails(a, hoursBack), {
          degradedSources,
          fallback: [],
        }),
      ),
      ...icloudAccounts.map(async a => {
        const password = decrypt(a.credentials_encrypted);
        return timeLiveWork("icloudEmail", () => fetchIcloudEmails(a, password, hoursBack), {
          degradedSources,
          fallback: [],
        });
      }),
    ];

    const [emailArrays, calendar, nextWeekCalendar, tomorrowCalendar, weather, bills, recentTransactions, actualMeta, resurfacedReadStates, todoistSyncHealth] = await Promise.all([
      Promise.all(emailPromises).then(arrays => arrays.flat()),
      timeLiveWork("calendarCurrent", () => fetchCalendar(calendarAccounts), {
        degradedSources,
        fallback: [],
      }),
      timeLiveWork("calendarNextWeek", () => fetchCalendar(calendarAccounts, getNextWeekRange()), {
        degradedSources,
        fallback: [],
      }),
      timeLiveWork("calendarTomorrow", () => fetchCalendar(calendarAccounts, getTomorrowRange()), {
        degradedSources,
        fallback: [],
      }),
      timeLiveWork("weather", () => fetchWeather(
        settings.weather_lat || 34.1442,
        settings.weather_lng || -117.9981,
      ), {
        degradedSources,
        fallback: weatherFallback(),
      }),
      settings.actual_budget_url
        ? timeLiveWork("actualBills", () => getUpcomingBills(userId), {
            degradedSources,
            fallback: [],
          })
        : skippedLiveSource("actualBills", [], "actual_not_configured"),
      settings.actual_budget_url
        ? timeLiveWork("actualRecentTransactions", () => getRecentTransactions(userId), {
            degradedSources,
            fallback: [],
          })
        : skippedLiveSource("actualRecentTransactions", [], "actual_not_configured"),
      settings.actual_budget_url
        ? timeLiveWork("actualMetadata", () => getActualMetadata(userId).then(m => ({
            schedules: m.schedules.map(s => ({ ...s, paid: isSchedulePaid(s, m.recentTransactions) })),
            payeeMap: m.payeeMap,
          })), {
            degradedSources,
            fallback: { schedules: [], payeeMap: {} },
          })
        : skippedLiveSource("actualMetadata", { schedules: [], payeeMap: {} }, "actual_not_configured"),
      resurfacedReadStatePromise,
      getTodoistSyncHealth(userId).catch((err) => unavailableTodoistHealth(err)),
    ]);

    // Apply Gmail's current read state to resurfaced entries. `null` means the
    // probe failed (auth/network/etc.) — fall through to the snapshot's own
    // `read` field so the row still renders sensibly.
    for (let i = 0; i < resurfacedEntries.length; i++) {
      const probed = resurfacedReadStates[i];
      const snapshotRead = !!resurfacedEntries[i].snapshot?.read;
      resurfacedEntries[i].read = probed === null ? snapshotRead : probed;
    }

    const newEmails = emailArrays
      .map(e => ({
        ...e,
        isImportantSender: importantSenderAddresses.has(extractEmailAddress(e.from)),
      }));

    // Add weather location
    const weatherWithLocation = {
      ...weather,
      location: settings.weather_location || "El Monte, CA",
    };

    res.locals.eaTiming = { degraded: degradedSources.length ? true : undefined };
    res.json({
      emails: newEmails,
      calendar,
      nextWeekCalendar,
      tomorrowCalendar,
      weather: weatherWithLocation,
      bills,
      recentTransactions,
      allSchedules: actualMeta.schedules,
      payeeMap: actualMeta.payeeMap,
      actualConfigured: !!settings.actual_budget_url,
      actualBudgetUrl: settings.actual_budget_url || null,
      importantSenders: Array.from(importantSendersMap.values()),
      briefingGeneratedAt,
      briefingReadStatus,
      snoozedEntries,
      resurfacedEntries,
      degraded: {
        any: degradedSources.length > 0,
        sources: degradedSources,
      },
      providerHealth: {
        todoist: todoistSyncHealth,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Live] Error fetching live data:", err.message);
    res.status(500).json({ message: "Failed to fetch live data" });
  }
});

export default router;
