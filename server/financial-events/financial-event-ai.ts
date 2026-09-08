import { createHash, randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import type { BillCandidate } from "../../shared/types/bills.ts";
import type { BillProviderRequestRunner } from "../bills/bill-candidate-verification-service.ts";
import type { FinancialDocument, FinancialEvent } from "./financial-event-store.ts";

// Longer than the extraction adapters' 120-second timeout. Unknown attempts
// remain charged against the budget after this lease expires.
const REQUEST_LEASE_MS = 3 * 60_000;
const MAX_ATTEMPTS = 3;

export function createFinancialEventAiStore(db: Pick<Client, "execute">, now = Date.now) {
  async function reserveDocumentAssessment(document: FinancialDocument, contentHash: string): Promise<number | null> {
    const result = await db.execute({
      sql: `INSERT INTO ea_financial_document_ai_attempts (user_id, document_id, content_hash, attempts)
        SELECT ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM ea_financial_documents d
          WHERE d.user_id = ? AND d.id = ? AND d.revision = ? AND d.claim_token = ?
            AND d.status = 'processing' AND d.claimed_at > ?)
        ON CONFLICT (user_id, document_id, content_hash) DO UPDATE SET attempts = attempts + 1
          WHERE attempts < ? RETURNING attempts`,
      args: [document.userId, document.id, contentHash, document.userId, document.id,
        document.revision, document.claimToken, now() - 15 * 60_000, MAX_ATTEMPTS],
    });
    return result.rows[0] ? Number(result.rows[0].attempts) : null;
  }

  function createAiRequestRunner(event: FinancialEvent): BillProviderRequestRunner {
    return async (provider, request, send) => {
      // Bump this protocol when adapter wire settings/schema change in a way
      // that should invalidate prior responses. No credentials or bodies persist.
      const key = createHash("sha256").update(JSON.stringify([
        "financial-event-extraction-v1", provider, request.model,
        request.usagePurpose || "extraction", request.systemPrompt, request.content,
      ])).digest("hex");
      const scope = [event.userId, event.id, key];
      async function cached(): Promise<BillCandidate | null> {
        const result = await db.execute({
          sql: `SELECT fields_json FROM ea_financial_event_ai_requests
                WHERE user_id = ? AND event_id = ? AND request_key = ? AND fields_json IS NOT NULL
                ORDER BY attempt LIMIT 1`, args: scope,
        });
        return result.rows[0] ? JSON.parse(String(result.rows[0].fields_json)) as BillCandidate : null;
      }
      const saved = await cached();
      if (saved) return { fields: saved, usage: {} };
      const timestamp = now();
      const token = randomUUID();
      const reserved = await db.execute({
        sql: `INSERT INTO ea_financial_event_ai_requests
                (token, user_id, event_id, request_key, attempt, created_at, expires_at)
              SELECT ?, ?, ?, ?, 1 + (SELECT COUNT(*) FROM ea_financial_event_ai_requests
                WHERE user_id = ? AND event_id = ? AND request_key = ?), ?, ?
              WHERE EXISTS (SELECT 1 FROM ea_financial_events e
                WHERE e.user_id = ? AND e.id = ? AND e.revision = ? AND e.claim_token = ?
                  AND e.status = 'processing' AND e.attempted_at IS NULL
                  AND e.claimed_at > ?
                  AND e.operation_json IS NULL AND e.owner_completion_json IS NULL
                  AND NOT EXISTS (SELECT 1 FROM ea_financial_corrected_sources g
                    WHERE g.user_id = e.user_id AND g.owner = 'event' AND g.record_id = e.id))
                AND (SELECT COUNT(*) FROM ea_financial_event_ai_requests
                  WHERE user_id = ? AND event_id = ? AND request_key = ?) < ?
                AND NOT EXISTS (SELECT 1 FROM ea_financial_event_ai_requests
                  WHERE user_id = ? AND event_id = ? AND request_key = ?
                    AND (fields_json IS NOT NULL OR expires_at > ?))
              ON CONFLICT DO NOTHING`,
        args: [token, ...scope, ...scope, timestamp, timestamp + REQUEST_LEASE_MS,
          event.userId, event.id, event.revision, event.claimToken, timestamp - 15 * 60_000,
          ...scope, MAX_ATTEMPTS, ...scope, timestamp],
      });
      if (reserved.rowsAffected !== 1) {
        const completed = await cached();
        if (completed) return { fields: completed, usage: {} };
        throw new Error("Financial AI request is already active, has exhausted its retry budget, or its source claim changed.");
      }
      let fields: BillCandidate;
      let usage: Record<string, unknown>;
      try {
        ({ fields, usage } = await send());
      } catch (error) {
        // If this save fails the unknown reservation still consumes an attempt.
        await db.execute({ sql: `UPDATE ea_financial_event_ai_requests SET finished_at = ?
          WHERE token = ? AND finished_at IS NULL`, args: [now(), token] });
        throw error;
      }
      // Deliberately independent of the event's current lease: a late paid
      // response is reusable, but cannot admit a financial operation.
      await db.execute({ sql: `UPDATE ea_financial_event_ai_requests SET fields_json = ?, finished_at = ?
        WHERE token = ? AND fields_json IS NULL`, args: [JSON.stringify(fields), now(), token] });
      return { fields, usage };
    };
  }
  return { createAiRequestRunner, reserveDocumentAssessment };
}
