export function iso(now) {
  return now.toISOString();
}

function boolInt(value) {
  return value ? 1 : 0;
}

export function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function occurrenceKey(event) {
  return String(event?.originalStartTime || event?.startMs || event?.id || "");
}

function searchableText(event) {
  return normalizeText([
    event.title,
    event.location,
    event.description,
  ].filter(Boolean).join(" "));
}

export function mirrorOccurrenceStatement(userId, event, timestamp) {
  const status = event.status || (event.is_deleted ? "cancelled" : "confirmed");
  const deletedAt = status === "cancelled" || event.is_deleted ? timestamp : null;
  return {
    sql: `INSERT INTO ea_calendar_search_occurrences
            (user_id, account_id, calendar_id, event_id, original_start_key,
             title, location, description, source_label, account_label, account_email,
             start_ms, end_ms, all_day, time_label, duration_label, source_color,
             event_color, color_id, html_link, open_url, recurring_event_id,
             recurring_kind, is_recurring, status, searchable_text, raw_json,
             synced_at, deleted_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, account_id, calendar_id, event_id, original_start_key) DO UPDATE SET
            title = excluded.title,
            location = excluded.location,
            description = excluded.description,
            source_label = excluded.source_label,
            account_label = excluded.account_label,
            account_email = excluded.account_email,
            start_ms = excluded.start_ms,
            end_ms = excluded.end_ms,
            all_day = excluded.all_day,
            time_label = excluded.time_label,
            duration_label = excluded.duration_label,
            source_color = excluded.source_color,
            event_color = excluded.event_color,
            color_id = excluded.color_id,
            html_link = excluded.html_link,
            open_url = excluded.open_url,
            recurring_event_id = excluded.recurring_event_id,
            recurring_kind = excluded.recurring_kind,
            is_recurring = excluded.is_recurring,
            status = excluded.status,
            searchable_text = excluded.searchable_text,
            raw_json = excluded.raw_json,
            synced_at = excluded.synced_at,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
          WHERE ea_calendar_search_occurrences.title IS NOT excluded.title
             OR ea_calendar_search_occurrences.location IS NOT excluded.location
             OR ea_calendar_search_occurrences.description IS NOT excluded.description
             OR ea_calendar_search_occurrences.source_label IS NOT excluded.source_label
             OR ea_calendar_search_occurrences.account_label IS NOT excluded.account_label
             OR ea_calendar_search_occurrences.account_email IS NOT excluded.account_email
             OR ea_calendar_search_occurrences.start_ms IS NOT excluded.start_ms
             OR ea_calendar_search_occurrences.end_ms IS NOT excluded.end_ms
             OR ea_calendar_search_occurrences.all_day IS NOT excluded.all_day
             OR ea_calendar_search_occurrences.time_label IS NOT excluded.time_label
             OR ea_calendar_search_occurrences.duration_label IS NOT excluded.duration_label
             OR ea_calendar_search_occurrences.source_color IS NOT excluded.source_color
             OR ea_calendar_search_occurrences.event_color IS NOT excluded.event_color
             OR ea_calendar_search_occurrences.color_id IS NOT excluded.color_id
             OR ea_calendar_search_occurrences.html_link IS NOT excluded.html_link
             OR ea_calendar_search_occurrences.open_url IS NOT excluded.open_url
             OR ea_calendar_search_occurrences.recurring_event_id IS NOT excluded.recurring_event_id
             OR ea_calendar_search_occurrences.recurring_kind IS NOT excluded.recurring_kind
             OR ea_calendar_search_occurrences.is_recurring IS NOT excluded.is_recurring
             OR ea_calendar_search_occurrences.status IS NOT excluded.status
             OR ea_calendar_search_occurrences.searchable_text IS NOT excluded.searchable_text
             OR ea_calendar_search_occurrences.raw_json IS NOT excluded.raw_json`,
    args: [
      userId,
      String(event.accountId || ""),
      String(event.calendarId || ""),
      String(event.id || ""),
      occurrenceKey(event),
      event.title || "",
      event.location || "",
      event.description || "",
      event.source || event.calendarName || "Google Calendar",
      event.accountLabel || null,
      event.accountEmail || null,
      Number(event.startMs || 0),
      Number(event.endMs || event.startMs || 0),
      boolInt(event.allDay),
      event.time || null,
      event.duration || null,
      event.sourceColor || null,
      event.color || event.sourceColor || null,
      event.colorId || null,
      event.htmlLink || null,
      event.openUrl || event.htmlLink || null,
      event.recurringEventId || null,
      event.recurringKind || null,
      boolInt(event.isRecurring || event.recurringEventId || event.originalStartTime),
      status,
      searchableText(event),
      JSON.stringify(event),
      timestamp,
      deletedAt,
      timestamp,
    ],
  };
}

export function upsertStateStatement(userId, account, calendar, window, timestamp) {
  return {
    sql: `INSERT INTO ea_calendar_search_mirror_state
            (user_id, account_id, calendar_id, account_label, account_email,
             calendar_label, source_color, window_start, window_end, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?)
          ON CONFLICT(user_id, account_id, calendar_id) DO UPDATE SET
            account_label = excluded.account_label,
            account_email = excluded.account_email,
            calendar_label = excluded.calendar_label,
            source_color = excluded.source_color,
            window_start = excluded.window_start,
            window_end = excluded.window_end,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      account.id,
      calendar.id,
      account.label || null,
      account.email || null,
      calendar.summary || calendar.id,
      calendar.backgroundColor || account.color || null,
      window.start,
      window.end,
      timestamp,
    ],
  };
}

export function stateSuccessStatement(userId, account, calendar, response, timestamp, isFullSync) {
  return {
    // dirty_since / sync_requested_at are only cleared if they predate this sync's
    // start (`timestamp`). A write that marks the row dirty DURING the fetch sets a
    // newer value, which must survive so a follow-up sync is still scheduled
    // (otherwise the mirror serves stale occurrences — a lost-update race).
    sql: `UPDATE ea_calendar_search_mirror_state
          SET sync_token = ?,
              status = 'idle',
              last_sync_at = ?,
              last_success_at = ?,
              last_full_sync_at = COALESCE(?, last_full_sync_at),
              last_incremental_sync_at = COALESCE(?, last_incremental_sync_at),
              last_error = NULL,
              sync_started_at = NULL,
              sync_requested_at = CASE WHEN sync_requested_at IS NOT NULL AND sync_requested_at > ? THEN sync_requested_at ELSE NULL END,
              sync_request_reason = CASE WHEN sync_requested_at IS NOT NULL AND sync_requested_at > ? THEN sync_request_reason ELSE NULL END,
              dirty_since = CASE WHEN dirty_since IS NOT NULL AND dirty_since > ? THEN dirty_since ELSE NULL END,
              dirty_reason = CASE WHEN dirty_since IS NOT NULL AND dirty_since > ? THEN dirty_reason ELSE NULL END,
              last_check_failed_at = NULL,
              failed_check_count = 0,
              updated_at = ?
          WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
    args: [
      response.nextSyncToken || response.syncToken || null,
      timestamp,
      timestamp,
      isFullSync ? timestamp : null,
      isFullSync ? null : timestamp,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      userId,
      account.id,
      calendar.id,
    ],
  };
}

export function tombstoneCalendarStatement(userId, account, calendar, timestamp) {
  return {
    sql: `UPDATE ea_calendar_search_occurrences
          SET status = 'cancelled',
              deleted_at = ?,
              updated_at = ?
          WHERE user_id = ? AND account_id = ? AND calendar_id = ?
            AND status != 'cancelled'`,
    args: [timestamp, timestamp, userId, account.id, calendar.id],
  };
}

export function tombstoneRecurringFamilyStatement(userId, account, calendar, event, timestamp) {
  const familyId = String(event.recurringEventId || event.id || "");
  return {
    sql: `UPDATE ea_calendar_search_occurrences
          SET status = 'cancelled',
              deleted_at = ?,
              updated_at = ?
          WHERE user_id = ?
            AND account_id = ?
            AND calendar_id = ?
            AND (event_id = ? OR recurring_event_id = ?)`,
    args: [timestamp, timestamp, userId, account.id, calendar.id, familyId, familyId],
  };
}

export function purgeExpiredTombstonesStatement(userId, cutoff) {
  return {
    sql: `DELETE FROM ea_calendar_search_occurrences
          WHERE user_id = ?
            AND status = 'cancelled'
            AND deleted_at IS NOT NULL
            AND deleted_at < ?`,
    args: [userId, cutoff],
  };
}

export function tombstoneUnlistedCalendarStatements(userId, account, calendarId, timestamp) {
  return [
    {
      sql: `UPDATE ea_calendar_search_occurrences
            SET status = 'cancelled',
                deleted_at = ?,
                updated_at = ?
            WHERE user_id = ?
              AND account_id = ?
              AND calendar_id = ?
              AND status != 'cancelled'`,
      args: [timestamp, timestamp, userId, account.id, calendarId],
    },
    {
      sql: `DELETE FROM ea_calendar_search_mirror_state
            WHERE user_id = ? AND account_id = ? AND calendar_id = ?`,
      args: [userId, account.id, calendarId],
    },
  ];
}
