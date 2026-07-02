import db from "../db/connection.js";

// Pin state is a per-email overlay, entirely outside the snapshot tables — the
// structural sibling of ea_snoozed_emails. Pins are NOT triage judgments and
// must never write ea_triage_feedback.

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function pin(userId, uid, snapshot = null, { dbClient = db } = {}) {
  const snapshotJson = snapshot ? JSON.stringify(snapshot) : null;
  // ON CONFLICT keeps the original pinned_at so a re-pin never reshuffles the
  // Pinned section; only the render-fallback snapshot refreshes.
  await dbClient.execute({
    sql: `INSERT INTO ea_pinned_emails (user_id, email_id, account_id, email_snapshot)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, email_id) DO UPDATE
            SET email_snapshot = COALESCE(excluded.email_snapshot, email_snapshot)`,
    args: [userId, uid, snapshot?.account_id || null, snapshotJson],
  });
}

export async function unpin(userId, uid, { dbClient = db } = {}) {
  await dbClient.execute({
    sql: "DELETE FROM ea_pinned_emails WHERE user_id = ? AND email_id = ?",
    args: [userId, uid],
  });
}

// Hydrates each pin from the live index/triage rows when present, falling back
// to the email_snapshot JSON captured at pin time. Deliberately ignores
// provider_state — a trashed/archived pinned email still hydrates (the UI
// renders it with trashed styling).
export async function loadPinnedEntries(userId, { dbClient = db } = {}) {
  const pins = await dbClient.execute({
    sql: `SELECT email_id, account_id, pinned_at, email_snapshot
          FROM ea_pinned_emails WHERE user_id = ? ORDER BY pinned_at DESC, email_id`,
    args: [userId],
  });
  if (!pins.rows.length) return [];
  const uids = pins.rows.map((row) => row.email_id);
  const placeholders = uids.map(() => "?").join(",");
  const [index, triage] = await Promise.all([
    dbClient.execute({
      sql: `SELECT uid, subject, from_name, from_address, body_snippet, email_date, read, account_id
            FROM ea_email_index WHERE user_id = ? AND uid IN (${placeholders})`,
      args: [userId, ...uids],
    }),
    dbClient.execute({
      sql: `SELECT email_id, lane, urgency, category, handled_at, provider_state
            FROM ea_email_triage WHERE user_id = ? AND email_id IN (${placeholders})`,
      args: [userId, ...uids],
    }),
  ]);
  const indexByUid = new Map(index.rows.map((row) => [row.uid, row]));
  const triageByUid = new Map(triage.rows.map((row) => [row.email_id, row]));
  return pins.rows.map((row) => {
    const snap = parseJson(row.email_snapshot) || {};
    const idx = indexByUid.get(row.email_id) || {};
    const tri = triageByUid.get(row.email_id) || {};
    return {
      uid: row.email_id,
      pinned_at: row.pinned_at,
      account_id: idx.account_id || row.account_id || snap.account_id || null,
      subject: idx.subject ?? snap.subject ?? "",
      from_name: idx.from_name ?? snap.from ?? "",
      from_address: idx.from_address ?? snap.from_email ?? "",
      preview: idx.body_snippet ?? snap.preview ?? "",
      date: idx.email_date ?? snap.date ?? null,
      read: idx.read != null ? !!idx.read : !!snap.read,
      account_label: snap.account_label || null,
      account_email: snap.account_email || null,
      account_color: snap.account_color || null,
      account_icon: snap.account_icon || null,
      lane: tri.lane || null,
      urgency: tri.urgency ?? snap.urgency ?? null,
      category: tri.category || null,
      handled_at: tri.handled_at || null,
      provider_state: tri.provider_state || null,
    };
  });
}
