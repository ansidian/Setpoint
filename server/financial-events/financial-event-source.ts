import { createHash } from "node:crypto";
import type { Client, Row } from "@libsql/client";
import type { FinancialEmailSource } from "../email/email-service.ts";
import { requireCompleteEmailEvidence } from "../email/email-evidence.ts";
import type { FinancialDocument } from "./financial-event-store.ts";

export type { FinancialEmailSource } from "../email/email-service.ts";

/** Source/parser changes invalidate acquisition, never owner/claim revisions. */
export function projectFinancialDocumentSource(document: FinancialDocument, row: Row): FinancialDocument {
  const authentication = document.senderAuthentication ? { ...document.senderAuthentication } : null;
  if (authentication) delete (authentication as Partial<typeof authentication>).evaluatedAt;
  const sourceInputHash = createHash("sha256").update(JSON.stringify([
    // v2 selects reader HTML instead of combining contradictory MIME alternatives.
    "financial-source-v2", document.emailUid, document.fromName, document.fromAddress, document.subject,
    document.body, document.emailDate, document.threadId, document.messageId, authentication,
  ])).digest("hex");
  let acquiredSource: FinancialEmailSource | null = null;
  if (row.acquired_source_key === sourceInputHash && typeof row.acquired_source_json === "string") {
    try { acquiredSource = JSON.parse(row.acquired_source_json) as FinancialEmailSource; } catch { /* Reacquire invalid saved evidence. */ }
  }
  return { ...document, ...(acquiredSource || {}), acquiredSource, sourceInputHash };
}

export function createFinancialDocumentSourceStore(db: Pick<Client, "execute">, now: () => number) {
  async function reserveDocumentSource(document: FinancialDocument): Promise<number | null> {
    if (!document.sourceInputHash) return null;
    const result = await db.execute({
      sql: `UPDATE ea_financial_documents SET source_attempts = CASE WHEN source_attempt_key = ? THEN source_attempts + 1 ELSE 1 END,
        source_attempt_key = ? WHERE user_id = ? AND id = ? AND revision = ? AND claim_token = ? AND status = 'processing'
        AND dismissed_at IS NULL AND claimed_at > ? AND (source_attempt_key IS NOT ? OR source_attempts < 3)
        RETURNING source_attempts`,
      args: [document.sourceInputHash, document.sourceInputHash, document.userId, document.id, document.revision,
        document.claimToken, now() - 15 * 60_000, document.sourceInputHash],
    });
    return result.rows[0] ? Number(result.rows[0].source_attempts) : null;
  }

  async function saveDocumentSource(document: FinancialDocument, source: FinancialEmailSource): Promise<boolean> {
    requireCompleteEmailEvidence(source.body);
    if (!document.sourceInputHash) return false;
    const result = await db.execute({
      sql: `UPDATE ea_financial_documents SET acquired_source_json = ?, acquired_source_key = ?, updated_at = ?
        WHERE user_id = ? AND id = ? AND revision = ? AND claim_token = ? AND status = 'processing'
          AND dismissed_at IS NULL AND claimed_at > ? AND source_attempt_key = ? AND source_attempts > 0`,
      args: [JSON.stringify(source), document.sourceInputHash, now(), document.userId, document.id,
        document.revision, document.claimToken, now() - 15 * 60_000, document.sourceInputHash],
    });
    return result.rowsAffected === 1;
  }
  return { reserveDocumentSource, saveDocumentSource };
}
