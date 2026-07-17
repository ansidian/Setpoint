import db from "../db/connection.ts";
import type { PinnedEmailEntry, PinnedEmailSnapshot } from "../../shared/types/email.ts";
import type { EmailWriteDb } from "./email-persistence-types.ts";

interface PinnedRow extends Record<string, unknown> {
  email_id: string;
  account_id?: string | null;
  pinned_at: string;
  email_snapshot?: string | null;
}

interface PinnedIndexRow extends Record<string, unknown> {
  uid: string;
  subject?: string | null;
  from_name?: string | null;
  from_address?: string | null;
  body_snippet?: string | null;
  email_date?: string | null;
  read?: number | boolean | null;
  account_id?: string | null;
}

interface PinnedTriageRow extends Record<string, unknown> {
  email_id: string;
  lane?: string | null;
  urgency?: string | null;
  category?: string | null;
  handled_at?: string | null;
  provider_state?: string | null;
}

// Pin state is a per-email overlay, entirely outside the snapshot tables — the
// structural sibling of ea_snoozed_emails. Pins are NOT triage judgments and
// must never write ea_triage_feedback.

function parseJson(value: unknown): PinnedEmailSnapshot | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as PinnedEmailSnapshot
      : null;
  } catch {
    return null;
  }
}

export async function pin(userId: string, uid: string, snapshot: PinnedEmailSnapshot | null = null, { dbClient = db }: { dbClient?: EmailWriteDb } = {}): Promise<void> {
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

export async function unpin(userId: string, uid: string, { dbClient = db }: { dbClient?: EmailWriteDb } = {}): Promise<void> {
  await dbClient.execute({
    sql: "DELETE FROM ea_pinned_emails WHERE user_id = ? AND email_id = ?",
    args: [userId, uid],
  });
}

// Hydrates each pin from the live index/triage rows when present, falling back
// to the email_snapshot JSON captured at pin time. Deliberately ignores
// provider_state — a trashed/archived pinned email still hydrates (the UI
// renders it with trashed styling).
export async function loadPinnedEntries(userId: string, { dbClient = db }: { dbClient?: EmailWriteDb } = {}): Promise<PinnedEmailEntry[]> {
  const pins = await dbClient.execute({
    sql: `SELECT email_id, account_id, pinned_at, email_snapshot
          FROM ea_pinned_emails WHERE user_id = ? ORDER BY pinned_at DESC, email_id`,
    args: [userId],
  });
  if (!pins.rows.length) return [];
  const pinRows = pins.rows as PinnedRow[];
  const uids = pinRows.map((row) => row.email_id);
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
  const indexByUid = new Map((index.rows as PinnedIndexRow[]).map((row) => [row.uid, row]));
  const triageByUid = new Map((triage.rows as PinnedTriageRow[]).map((row) => [row.email_id, row]));
  return pinRows.map((row) => {
    const snap: PinnedEmailSnapshot = parseJson(row.email_snapshot) || {};
    const idx: Partial<PinnedIndexRow> = indexByUid.get(row.email_id) || {};
    const tri: Partial<PinnedTriageRow> = triageByUid.get(row.email_id) || {};
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
