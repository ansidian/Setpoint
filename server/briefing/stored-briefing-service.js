import db from "../db/connection.js";
import { canonicalizeConfiguredAccounts } from "./account-canonical.js";

// --- Core primitives ---

async function loadLatest(userId) {
  const result = await db.execute({
    sql: `SELECT id, briefing_json FROM ea_briefings
          WHERE user_id = ? AND status = 'ready'
          ORDER BY generated_at DESC LIMIT 1`,
    args: [userId],
  });
  if (!result.rows.length) return null;
  return {
    id: result.rows[0].id,
    briefing: JSON.parse(result.rows[0].briefing_json),
  };
}

async function mutateLatest(userId, mutator) {
  const latest = await loadLatest(userId);
  if (!latest) return null;
  const changed = mutator(latest.briefing);
  if (changed) {
    await db.execute({
      sql: "UPDATE ea_briefings SET briefing_json = ? WHERE id = ?",
      args: [JSON.stringify(latest.briefing), latest.id],
    });
  }
  return latest;
}

// --- Shared helpers ---

function laDate(offsetMs = 0) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });
  return fmt.format(new Date(Date.now() + offsetMs));
}

function recomputeTaskStats(section) {
  const today = laDate();
  const weekFromNow = laDate(7 * 86400000);
  let totalPoints = 0, dueToday = 0, dueThisWeek = 0, incomplete = 0;
  for (const d of section.upcoming) {
    if (d.status !== "complete") incomplete++;
    if (d.due_date === today) dueToday++;
    if (d.due_date >= today && d.due_date <= weekFromNow) dueThisWeek++;
    if (d.points_possible) totalPoints += d.points_possible;
  }
  section.stats = { incomplete, dueToday, dueThisWeek, totalPoints };
}

function countUnreadEmails(emails = []) {
  return emails.filter((email) => !email.read).length;
}

// --- Email mutations ---

export async function markEmailsRead(userId, uids) {
  const uidSet = new Set(Array.isArray(uids) ? uids : [uids]);
  return mutateLatest(userId, (briefing) => {
    let changed = false;
    for (const acct of briefing.emails?.accounts || []) {
      for (const email of (acct.important ?? [])) {
        if ((uidSet.has(email.id) || uidSet.has(email.uid)) && !email.read) {
          email.read = true;
          changed = true;
        }
      }
      acct.unread = countUnreadEmails(acct.important);
    }
    return changed;
  });
}

export async function markEmailsUnread(userId, uids) {
  const uidSet = new Set(Array.isArray(uids) ? uids : [uids]);
  return mutateLatest(userId, (briefing) => {
    let changed = false;
    for (const acct of briefing.emails?.accounts || []) {
      for (const email of (acct.important ?? [])) {
        if ((uidSet.has(email.id) || uidSet.has(email.uid)) && email.read) {
          email.read = false;
          changed = true;
        }
      }
      acct.unread = countUnreadEmails(acct.important);
    }
    return changed;
  });
}

export async function removeDismissedEmailFromBriefing(userId, emailId) {
  return mutateLatest(userId, (briefing) => {
    let changed = false;
    for (const acct of briefing.emails?.accounts || []) {
      const before = acct.important?.length ?? 0;
      acct.important = (acct.important ?? []).filter((e) => e.id !== emailId);
      if (acct.important.length !== before) {
        acct.unread = countUnreadEmails(acct.important);
        changed = true;
      }
    }
    return changed;
  });
}

// --- Task mutations ---

export async function applyTaskCompletion(userId, { taskId, isRecurringTodoist, isTodoistOnly }) {
  // Recurring Todoist: tombstone injection on next refresh handles visibility.
  if (isRecurringTodoist) return null;
  return mutateLatest(userId, (briefing) => {
    let changed = false;
    if (isTodoistOnly) {
      const task = briefing.todoist?.upcoming?.find(
        (t) => !t._tombstone && t.id === taskId,
      );
      if (task && task.status !== "complete") {
        task.status = "complete";
        recomputeTaskStats(briefing.todoist);
        changed = true;
      }
    } else {
      // Find the CTM task first so we can also remove any linked Todoist task.
      const ctmTask = briefing.ctm?.upcoming?.find((t) => String(t.id) === taskId);
      const linkedTodoistId = ctmTask?.todoist_id;

      for (const sectionKey of ["ctm", "todoist"]) {
        if (!briefing[sectionKey]?.upcoming) continue;
        const before = briefing[sectionKey].upcoming.length;
        briefing[sectionKey].upcoming = briefing[sectionKey].upcoming.filter((t) => {
          if (sectionKey === "ctm") {
            return String(t.id) !== taskId && t.todoist_id !== taskId;
          }
          // todoist section: remove by direct id match or if it's the linked task
          return String(t.id) !== taskId && (!linkedTodoistId || String(t.id) !== String(linkedTodoistId));
        });
        if (briefing[sectionKey].upcoming.length !== before) {
          recomputeTaskStats(briefing[sectionKey]);
          changed = true;
        }
      }
    }
    return changed;
  });
}

export async function applyCTMStatusChange(userId, taskId, status) {
  return mutateLatest(userId, (briefing) => {
    const task = briefing.ctm?.upcoming?.find((t) => String(t.id) === taskId);
    if (!task) return false;
    task.status = status;
    return true;
  });
}

export async function applyCTMCompletionAfterTodoistClose(userId, taskId) {
  return mutateLatest(userId, (briefing) => {
    if (!briefing.ctm?.upcoming) return false;
    const before = briefing.ctm.upcoming.length;
    briefing.ctm.upcoming = briefing.ctm.upcoming.filter(
      (t) => String(t.id) !== taskId,
    );
    if (briefing.ctm.upcoming.length === before) return false;
    recomputeTaskStats(briefing.ctm);
    return true;
  });
}

// --- Todoist mirroring ---

export async function upsertTodoistTask(userId, task, { replace }) {
  return mutateLatest(userId, (briefing) => {
    if (!briefing.todoist) briefing.todoist = { upcoming: [], stats: {} };
    if (!Array.isArray(briefing.todoist.upcoming)) briefing.todoist.upcoming = [];
    const newTask = { status: "incomplete", ...task };
    const idx = briefing.todoist.upcoming.findIndex(
      (t) => !t._tombstone && String(t.id) === String(task.id),
    );
    if (idx >= 0) {
      if (!replace) return false;
      briefing.todoist.upcoming[idx] = { ...briefing.todoist.upcoming[idx], ...task };
    } else {
      briefing.todoist.upcoming.push(newTask);
    }
    return true;
  });
}

export async function removeTodoistTask(userId, taskId) {
  return mutateLatest(userId, (briefing) => {
    if (!briefing.todoist?.upcoming?.length) return false;
    const before = briefing.todoist.upcoming.length;
    briefing.todoist.upcoming = briefing.todoist.upcoming.filter(
      (t) => t._tombstone || String(t.id) !== String(taskId),
    );
    return briefing.todoist.upcoming.length !== before;
  });
}

// --- Read-side: merge account prefs into a briefing object ---

export async function mergeAccountPrefs(briefing, userId) {
  if (!briefing?.emails?.accounts?.length) return briefing;
  const result = await db.execute({
    sql: "SELECT id, email, label, color, icon FROM ea_accounts WHERE user_id = ?",
    args: [userId],
  });
  const canonicalAccounts = canonicalizeConfiguredAccounts(result.rows);
  const byEmail = new Map(canonicalAccounts.map((a) => [a.email, a]));
  const byLabel = new Map(canonicalAccounts.map((a) => [a.label, a]));
  for (const acc of briefing.emails.accounts) {
    const dbAcc = byLabel.get(acc.name) || byEmail.get(acc.name);
    if (dbAcc) {
      acc.name = dbAcc.label;
      acc.color = dbAcc.color || acc.color;
      acc.icon = dbAcc.icon || acc.icon;
    }
  }
  return briefing;
}
