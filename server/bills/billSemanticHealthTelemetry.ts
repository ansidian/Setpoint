import { createHash } from "node:crypto";
import type { BillCandidate, BillPayResolution, BillPaySource } from "../../shared/types/bills.ts";

export type BillEnrichmentPersistence = "already_persisted" | "newly_persisted" | "cas_lost" | "not_persisted";

export interface BillSemanticHealthTelemetry {
  event: "bill_semantic_health";
  email_fingerprint: string | null;
  source: BillPaySource;
  event_kind: string | null;
  mapping_status: string;
  mapping_reason: string | null;
  amount_verification: string | null;
  event_verification: string | null;
  target_verification: string | null;
  enrichment_persistence: BillEnrichmentPersistence;
}

function emailFingerprint(userId: string, accountId?: string | null, emailId?: string | null): string | null {
  if (!accountId || !emailId) return null;
  return createHash("sha256")
    .update(`bill-semantic-health:v1\0${userId}\0${accountId}\0${emailId}`)
    .digest("hex");
}

export function billSemanticHealthTelemetry({
  userId,
  accountId = null,
  emailId = null,
  source,
  resolution,
  persistence,
}: {
  userId: string;
  accountId?: string | null;
  emailId?: string | null;
  source: BillPaySource;
  resolution: BillPayResolution;
  persistence: BillEnrichmentPersistence;
}): BillSemanticHealthTelemetry {
  const candidate = resolution.bill as BillCandidate;
  return {
    event: "bill_semantic_health",
    email_fingerprint: emailFingerprint(userId, accountId, emailId),
    source,
    event_kind: candidate.event_kind || null,
    mapping_status: resolution.mapping.status,
    mapping_reason: resolution.mapping.reason || null,
    amount_verification: candidate.amount_verification?.status || null,
    event_verification: candidate.event_verification?.status || null,
    target_verification: candidate.target_verification?.status || null,
    enrichment_persistence: persistence,
  };
}

export function emitBillSemanticHealthTelemetry(telemetry: BillSemanticHealthTelemetry): void {
  console.info(`[EA] ${JSON.stringify(telemetry)}`);
}
