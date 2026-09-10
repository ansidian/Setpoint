import type { Client } from '@libsql/client';
import db from '../db/connection.ts';
import type { BillCandidate } from '../../shared/types/bills.ts';
import { projectStatement } from './finance-statement-model.ts';

/** Original bill sources only. Reads never acquire email or revisit financial intake. */
export async function readUtilityStatements(userId: string, budgetId: string, start: string, dbClient: Pick<Client, 'execute'> = db) {
  const result = await dbClient.execute({ sql: `WITH sources AS (
    SELECT d.id, d.email_uid, d.event_id,
      CASE WHEN receipt.record_id IS NOT NULL THEN json_extract(saved.value, '$.candidate') ELSE d.candidate_json END AS candidate,
      COALESCE(json_extract(d.acquired_source_json, '$.subject'), e.subject, '') AS subject,
      COALESCE(json_extract(d.acquired_source_json, '$.body'), e.body_text, '') AS body,
      COALESCE(json_extract(d.acquired_source_json, '$.fromAddress'), e.from_address, '') AS sender,
      COALESCE(json_extract(d.acquired_source_json, '$.emailDate'), e.email_date_utc, '') AS received_at
    FROM ea_financial_documents d
    LEFT JOIN ea_email_index e ON e.user_id=d.user_id AND e.uid=d.email_uid
    LEFT JOIN ea_financial_events event ON event.user_id=d.user_id AND event.id=d.event_id
    LEFT JOIN ea_financial_original_receipts receipt ON receipt.user_id=d.user_id AND receipt.owner='event' AND receipt.record_id=d.event_id
    LEFT JOIN json_each(COALESCE(json_extract(receipt.input_json, '$.sources'),
      json_extract(receipt.input_json, '$.operation.sourceEvidence'), json_extract(receipt.input_json, '$.sourceEvidence'))) saved
      ON json_extract(saved.value, '$.emailUid')=d.email_uid
    WHERE d.user_id=? AND d.dismissed_at IS NULL AND event.dismissed_at IS NULL
      AND (receipt.record_id IS NOT NULL OR (d.status NOT IN ('ignored', 'pending', 'processing') AND d.processed_revision=d.revision))
  ), originals AS (
    SELECT * FROM sources WHERE json_extract(candidate, '$.type')='bill'
      AND json_extract(candidate, '$.event_kind') IN ('bill_issued', 'statement_issued')
      AND COALESCE(json_extract(candidate, '$.document_role'), 'statement')='statement'
  ), matched AS (
    SELECT originals.*, utility.id AS utility_id,
      row_number() OVER (PARTITION BY utility.id, COALESCE(event_id, 'document:' || originals.id) ORDER BY originals.id) AS source_order
    FROM originals JOIN ea_finance_utilities utility ON utility.user_id=? AND utility.budget_id=?
      AND EXISTS (SELECT 1 FROM json_each(utility.source_senders_json) sender WHERE lower(sender.value)=lower(originals.sender))
      AND (utility.source_identity_text='' OR instr(lower(originals.subject || ' ' || originals.body), lower(utility.source_identity_text))>0)
  ) SELECT * FROM matched WHERE source_order=1 AND julianday(received_at)>=julianday(?)
    ORDER BY received_at DESC, id DESC LIMIT 501`, args: [userId, userId, budgetId, start] });
  return {
    truncated: result.rows.length > 500,
    statements: result.rows.slice(0, 500).map(source => projectStatement({
      id: `managed:${source.email_uid}`, utilityId: String(source.utility_id), emailUid: String(source.email_uid),
      subject: String(source.subject), receivedAt: String(source.received_at), body: String(source.body),
      candidate: JSON.parse(String(source.candidate)) as BillCandidate,
    })),
  };
}
