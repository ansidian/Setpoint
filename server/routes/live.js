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

const router = Router();
router.use(requireCookieSession);

function extractEmailAddress(from) {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : from.toLowerCase().trim();
}

// GET /api/live/all — combined live data endpoint
router.get("/all", async (_req, res) => {
  const userId = process.env.EA_USER_ID;

  try {
    const { accounts, settings } = await loadUserConfig(userId);
    const briefingGeneratedAt = null;
    const briefingReadStatus = {};
    const hoursBack = 12;

    // Build important senders list (manual only) + load pinned + active snoozes.
    // Snapshots travel with pins/snoozes so the inbox can render pinned emails
    // that have aged out of the current briefing window, and expose "waking"
    // snoozes without waiting for the next briefing.
    const nowTs = Date.now();
    const [manualSendersRaw, pinnedResult, snoozedResult, resurfacedResult] = await Promise.all([
      Promise.resolve(settings.important_senders_json),
      db.execute({
        sql: "SELECT email_id, email_snapshot FROM ea_pinned_emails WHERE user_id = ?",
        args: [userId],
      }),
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
    ]);
    const parseSnapshot = (raw) => {
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    };
    const pinnedIds = pinnedResult.rows.map(r => r.email_id);
    const pinnedSnapshots = pinnedResult.rows
      .map(r => parseSnapshot(r.email_snapshot))
      .filter(Boolean);
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
    const resurfacedReadStatePromise = Promise.all(
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
    );

    const emailPromises = [
      ...gmailAccounts.map(a =>
        fetchGmailEmails(a, hoursBack).catch(err => {
          console.error(`[Live] Gmail fetch failed for ${a.email}:`, err.message);
          return [];
        }),
      ),
      ...icloudAccounts.map(async a => {
        const password = decrypt(a.credentials_encrypted);
        try {
          return await fetchIcloudEmails(a, password, hoursBack);
        } catch (err) {
          console.error(`[Live] iCloud fetch failed for ${a.email}:`, err.message);
          return [];
        }
      }),
    ];

    const [emailArrays, calendar, nextWeekCalendar, tomorrowCalendar, weather, bills, recentTransactions, actualMeta, resurfacedReadStates] = await Promise.all([
      Promise.all(emailPromises).then(arrays => arrays.flat()),
      fetchCalendar(calendarAccounts).catch(err => {
        console.error("[Live] Calendar fetch failed:", err.message);
        return [];
      }),
      fetchCalendar(calendarAccounts, getNextWeekRange()).catch(err => {
        console.error("[Live] Next week calendar fetch failed:", err.message);
        return [];
      }),
      fetchCalendar(calendarAccounts, getTomorrowRange()).catch(err => {
        console.error("[Live] Tomorrow calendar fetch failed:", err.message);
        return [];
      }),
      fetchWeather(
        settings.weather_lat || 34.1442,
        settings.weather_lng || -117.9981,
      ).catch(err => {
        console.error("[Live] Weather fetch failed:", err.message);
        return { temp: 0, high: 0, low: 0, summary: "Weather unavailable", hourly: [] };
      }),
      settings.actual_budget_url
        ? getUpcomingBills(userId).catch(err => {
            console.error("[Live] Actual Budget fetch failed:", err.message);
            return [];
          })
        : Promise.resolve([]),
      settings.actual_budget_url
        ? getRecentTransactions(userId).catch(err => {
            console.error("[Live] Actual Budget recent transactions fetch failed:", err.message);
            return [];
          })
        : Promise.resolve([]),
      settings.actual_budget_url
        ? getActualMetadata(userId).then(m => ({
            schedules: m.schedules.map(s => ({ ...s, paid: isSchedulePaid(s, m.recentTransactions) })),
            payeeMap: m.payeeMap,
          })).catch(err => {
            console.error("[Live] Actual Budget metadata fetch failed:", err.message);
            return { schedules: [], payeeMap: {} };
          })
        : Promise.resolve({ schedules: [], payeeMap: {} }),
      resurfacedReadStatePromise,
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
      pinnedIds,
      pinnedSnapshots,
      snoozedEntries,
      resurfacedEntries,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Live] Error fetching live data:", err.message);
    res.status(500).json({ message: "Failed to fetch live data" });
  }
});

export default router;
