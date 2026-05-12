import { useEffect, useRef, useCallback } from "react";
import { publicAssetUrl } from "@/publicAsset";

const STORAGE_KEYS = {
  emails: "ea_notified_emails",
  events: "ea_notified_events",
  billsDate: "ea_notified_bills_date",
};

const CALENDAR_LEAD_TIME_MS = 15 * 60 * 1000;

function loadSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

function saveSet(key, set) {
  // keep only the last 200 entries to prevent unbounded growth
  const arr = [...set].slice(-200);
  localStorage.setItem(key, JSON.stringify(arr));
}

const hasNotificationAPI = typeof Notification !== "undefined";

function notify(title, body) {
  if (!hasNotificationAPI || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: publicAssetUrl("favicon.svg") });
  } catch {
    // notification failed silently
  }
}

export default function useNotifications(liveData) {
  const permissionRef = useRef(hasNotificationAPI ? Notification.permission : "denied");
  const hasInteractedRef = useRef(false);

  // Request permission after first user interaction
  const requestPermission = useCallback(() => {
    if (!hasNotificationAPI || hasInteractedRef.current) return;
    hasInteractedRef.current = true;
    if (permissionRef.current === "default") {
      Notification.requestPermission().then(p => {
        permissionRef.current = p;
      });
    }
  }, []);

  useEffect(() => {
    const handler = () => requestPermission();
    document.addEventListener("click", handler, { once: true });
    return () => document.removeEventListener("click", handler);
  }, [requestPermission]);

  // Check for notifications on each data update
  const { liveCalendar, liveBills, liveEmails, lastFetched } = liveData || {};
  useEffect(() => {
    if (!lastFetched) return;
    if (permissionRef.current !== "granted") return;

    // Calendar: 15 min warning
    const notifiedEvents = loadSet(STORAGE_KEYS.events);
    const now = Date.now();
    for (const event of liveCalendar || []) {
      if (event.passed || event.allDay || !event.startMs) continue;
      const timeUntil = event.startMs - now;
      if (timeUntil > 0 && timeUntil <= CALENDAR_LEAD_TIME_MS) {
        const eventKey = `${event.title}-${event.startMs}`;
        if (!notifiedEvents.has(eventKey)) {
          const mins = Math.round(timeUntil / 60000);
          notify(
            `${event.title}`,
            `Starting in ${mins} minute${mins !== 1 ? "s" : ""}${event.time ? ` at ${event.time}` : ""}`,
          );
          notifiedEvents.add(eventKey);
        }
      }
    }
    saveSet(STORAGE_KEYS.events, notifiedEvents);

    // Bills due today: once per day
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const lastBillNotifyDate = localStorage.getItem(STORAGE_KEYS.billsDate);
    if (lastBillNotifyDate !== today) {
      const dueTodayBills = (liveBills || []).filter(b => b.isDueToday);
      if (dueTodayBills.length > 0) {
        const names = dueTodayBills.map(b => b.payee || b.name).join(", ");
        notify(
          `${dueTodayBills.length} bill${dueTodayBills.length !== 1 ? "s" : ""} due today`,
          names,
        );
        localStorage.setItem(STORAGE_KEYS.billsDate, today);
      }
    }

    // Important sender emails
    const notifiedEmails = loadSet(STORAGE_KEYS.emails);
    for (const email of liveEmails || []) {
      if (!email.isImportantSender) continue;
      if (notifiedEmails.has(email.uid)) continue;
      notify(
        `New email from ${email.from}`,
        email.subject || "(no subject)",
      );
      notifiedEmails.add(email.uid);
    }
    saveSet(STORAGE_KEYS.emails, notifiedEmails);
  }, [lastFetched, liveCalendar, liveBills, liveEmails]);

  return { requestPermission };
}
