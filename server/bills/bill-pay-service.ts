import db from "../db/connection.ts";
import { getMetadata as projectedGetMetadata } from "../actual/actual-metadata-projection.ts";
import { readBillsMirrorRange } from "./bills-mirror-sync.ts";
import { queryTransactions } from "../transactions/transactions-service.ts";
import { parseBillPayMappingsJson } from "./bill-pay-mappings.ts";
import { createBillCandidateVerificationService } from "./bill-candidate-verification-service.ts";
import { resolveSemanticBillPay } from "./bill-semantic-resolution.ts";
import {
  DEFAULT_BILL_EXTRACT_MODEL,
  DEFAULT_BILL_EXTRACT_PROVIDER,
  resolveBillExtractModelConfig,
} from "./bill-extractors/catalog.ts";
import { resolveStatementActualStatus } from "./statementActualStatusModel.ts";
import {
  billSemanticHealthTelemetry,
  emitBillSemanticHealthTelemetry,
  type BillEnrichmentPersistence,
  type BillSemanticHealthTelemetry,
} from "./billSemanticHealthTelemetry.ts";
import type { InStatement } from "@libsql/client";
import type { ActualMetadata } from "../../shared/types/actual.ts";
import type { BillsMirrorHealth } from "../../shared/types/bills.ts";
import type { TransactionQueryResult } from "../../shared/types/transactions.ts";
import type {
  BillCandidate,
  BillEmailContext,
  BillPayMappings,
  BillPayMetadata,
  BillPayResolution,
  BillPaySource,
} from "../../shared/types/bills.ts";

interface BillsReadDb {
  execute(statement: InStatement): Promise<{ rows: Array<Record<string, unknown>>; rowsAffected?: number }>;
}

export interface SeedOptions {
  emailId?: string | null;
  accountId?: string | null;
  email?: BillEmailContext;
  subject?: unknown;
  from?: unknown;
  body?: unknown;
  snippet?: unknown;
  candidate?: BillCandidate | null;
  source?: BillPaySource;
  dbClient?: BillsReadDb;
}

interface ProjectedActualMetadata extends ActualMetadata {
  syncHealth: BillsMirrorHealth;
}

interface OccurrenceData {
  schedules: Array<{
    scheduleId: string;
    name?: string;
    amount?: number;
    next_date?: string;
    paid?: boolean;
    type?: string;
  }>;
  syncHealth?: BillsMirrorHealth;
}

export interface SeedDependencies {
  metadataReader?: (userId: string) => Promise<ProjectedActualMetadata>;
  occurrenceReader?: (
    userId: string,
    range: { start: string; end: string },
    options: { dbClient: BillsReadDb },
  ) => Promise<OccurrenceData>;
  transactionReader?: (userId: string, filters: Parameters<typeof queryTransactions>[1]) => Promise<TransactionQueryResult>;
  now?: Date;
  emitSemanticHealthTelemetry?: (telemetry: BillSemanticHealthTelemetry) => void;
  candidateVerification?: ReturnType<typeof createBillCandidateVerificationService>;
}

interface BillPaySettings {
  mappings: BillPayMappings;
  provider: string;
  model: string;
}

async function loadBillPaySettings(userId: string, { dbClient = db }: { dbClient?: BillsReadDb } = {}): Promise<BillPaySettings> {
  try {
    const result = await dbClient.execute({
      sql: `SELECT bill_pay_mappings_json, bill_extract_provider, bill_extract_model
            FROM ea_settings WHERE user_id = ?`,
      args: [userId],
    });
    const row = result.rows?.[0];
    return {
      mappings: parseBillPayMappingsJson(row?.bill_pay_mappings_json),
      ...resolveBillExtractModelConfig({
        provider: row?.bill_extract_provider,
        model: row?.bill_extract_model,
      }),
    };
  } catch {
    return {
      mappings: parseBillPayMappingsJson(null),
      provider: DEFAULT_BILL_EXTRACT_PROVIDER,
      model: DEFAULT_BILL_EXTRACT_MODEL,
    };
  }
}

const defaultCandidateVerification = createBillCandidateVerificationService();

async function resolveConfiguredBillPay({
  settings,
  metadata,
  source,
  email,
  candidate,
  candidateVerification = defaultCandidateVerification,
  allowProviderCalls = true,
}: {
  settings: BillPaySettings;
  metadata?: BillPayMetadata;
  source: BillPaySource;
  email: BillEmailContext;
  candidate?: BillCandidate | null;
  candidateVerification?: ReturnType<typeof createBillCandidateVerificationService>;
  allowProviderCalls?: boolean;
}): Promise<BillPayResolution> {
  return resolveSemanticBillPay({
    mappings: settings.mappings,
    metadata,
    source,
    email,
    candidate,
    verifyCandidate: allowProviderCalls ? ({ email: verificationEmail, candidate: verificationCandidate }) => (
      candidateVerification.verifyEmailCandidate({
        email: verificationEmail,
        candidate: verificationCandidate,
        providerId: settings.provider,
        model: settings.model,
      })
    ) : undefined,
    selectTargetPolicy: allowProviderCalls ? ({ email: selectionEmail, candidate: selectionCandidate, behaviors }) => (
      candidateVerification.selectEmailTargetPolicy({
        email: selectionEmail,
        candidate: selectionCandidate,
        behaviors,
        providerId: settings.provider,
        model: settings.model,
      })
    ) : undefined,
  });
}

interface StoredBillCandidateContext {
  candidate: BillCandidate | null;
  originalJson: string | null;
  accountId: string;
  emailId: string;
  email: BillEmailContext;
}

async function loadServerBillCandidate(userId: string, { emailId, accountId = null }: { emailId?: string | null; accountId?: string | null }, { dbClient = db }: { dbClient?: BillsReadDb } = {}): Promise<StoredBillCandidateContext | null> {
  if (!emailId) return null;
  const accountFilter = accountId ? "AND t.account_id = ?" : "";
  const args = accountId ? [userId, emailId, accountId] : [userId, emailId];
  const result = await dbClient.execute({
    sql: `SELECT t.bill_candidate_json,
                 t.account_id,
                 t.email_id,
                 i.from_name,
                 i.from_address,
                 i.subject,
                 i.body_snippet,
                 i.body_text
          FROM ea_email_triage t
          LEFT JOIN ea_email_index i
            ON i.user_id = t.user_id
           AND i.account_id = t.account_id
           AND i.uid = t.email_id
          WHERE t.user_id = ?
            AND t.email_id = ?
            ${accountFilter}
          ORDER BY t.updated_at DESC
          LIMIT 1`,
    args,
  });
  const row = result.rows?.[0];
  if (!row) return null;
  let candidate = null;
  if (row.bill_candidate_json) {
    try {
      candidate = JSON.parse(String(row.bill_candidate_json)) as BillCandidate;
    } catch {
      candidate = null;
    }
  }
  return {
    candidate,
    originalJson: row.bill_candidate_json == null ? null : String(row.bill_candidate_json),
    accountId: String(row.account_id),
    emailId: String(row.email_id),
    email: {
      from: [row.from_name, row.from_address].filter(Boolean).join(" "),
      from_address: row.from_address || "",
      subject: row.subject || "",
      snippet: row.body_snippet || "",
      body: row.body_text || "",
    },
  };
}

async function compareAndSwapBillCandidate(
  userId: string,
  context: StoredBillCandidateContext,
  candidate: BillCandidate,
  dbClient: BillsReadDb,
): Promise<boolean> {
  if (context.originalJson == null) return false;
  const result = await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET bill_candidate_json = ?,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
            AND bill_candidate_json = ?`,
    args: [
      JSON.stringify(candidate),
      userId,
      context.accountId,
      context.emailId,
      context.originalJson,
    ],
  });
  return Number(result.rowsAffected || 0) === 1;
}

export async function enrichBillCandidate(userId: string, {
  email = {},
  candidate,
  mappings = null,
  metadata = null,
  source = "triage",
  dbClient = db,
}: {
  email?: BillEmailContext;
  candidate: BillCandidate;
  mappings?: BillPayMappings | null;
  metadata?: BillPayMetadata | null;
  source?: BillPaySource;
  dbClient?: BillsReadDb;
}, {
  candidateVerification = defaultCandidateVerification,
}: {
  candidateVerification?: ReturnType<typeof createBillCandidateVerificationService>;
} = {}): Promise<BillPayResolution> {
  const settings = await loadBillPaySettings(userId, { dbClient });
  const effectiveSettings = {
    ...settings,
    mappings: mappings ? parseBillPayMappingsJson(JSON.stringify(mappings)) : settings.mappings,
  };
  const effectiveMetadata = metadata || await projectedGetMetadata(userId)
    .then((projection) => projection.syncHealth?.state === "current" ? projection : {})
    .catch(() => ({}));
  const alreadyEnriched = Boolean(candidate.semantic_enrichment);
  try {
    const resolved = await resolveConfiguredBillPay({
      settings: effectiveSettings,
      metadata: effectiveMetadata,
      source,
      email,
      candidate,
      candidateVerification,
      allowProviderCalls: !alreadyEnriched,
    });
    return {
      ...resolved,
      bill: {
        ...resolved.bill,
        semantic_enrichment: candidate.semantic_enrichment || {
          status: resolved.bill.target_verification?.status === "failed" ? "failed" : "complete",
          provider: settings.provider,
          model: settings.model,
          ...(resolved.bill.target_verification?.status === "failed" ? { reason: "target_verification_failed" } : {}),
        },
      },
    };
  } catch {
    const resolved = await resolveConfiguredBillPay({
      settings: effectiveSettings,
      metadata: effectiveMetadata,
      source,
      email,
      candidate,
      allowProviderCalls: false,
    });
    return {
      ...resolved,
      bill: {
        ...resolved.bill,
        semantic_enrichment: {
          status: "failed",
          provider: settings.provider,
          model: settings.model,
          reason: "provider_unavailable",
        },
      },
    };
  }
}

function todayYmd(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function unavailableMetadata(error: unknown = null): ProjectedActualMetadata {
  return {
    accounts: [],
    payees: [],
    payeeMap: {},
    categories: [],
    schedules: [],
    recentTransactions: [],
    syncHealth: {
      state: "unavailable",
      lastSuccessAt: null,
      lastError: error instanceof Error ? error.message : null,
    },
  };
}

export async function resolveBillPaySeed(
  userId: string,
  payload: SeedOptions = {},
  options: SeedDependencies = {},
): Promise<BillPayResolution> {
  const {
    emailId = null,
    accountId = null,
    email = {},
    subject,
    from,
    body,
    snippet,
    candidate = null,
    source = "triage",
    dbClient = db,
  } = payload;
  const {
    metadataReader = projectedGetMetadata,
    occurrenceReader = readBillsMirrorRange as unknown as NonNullable<SeedDependencies["occurrenceReader"]>,
    transactionReader = queryTransactions,
    now = new Date(),
    emitSemanticHealthTelemetry = emitBillSemanticHealthTelemetry,
    candidateVerification,
  } = options;
  const [settings, serverContext, metadata] = await Promise.all([
    loadBillPaySettings(userId, { dbClient }),
    loadServerBillCandidate(userId, { emailId, accountId }, { dbClient }),
    metadataReader(userId).catch((error: unknown) => unavailableMetadata(error)),
  ]);
  const requestEmail = {
    ...email,
    ...(subject !== undefined ? { subject } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
  };
  const mappingMetadata = metadata.syncHealth?.state === "current" ? metadata : {};
  const effectiveEmail = {
    ...(serverContext?.email || {}),
    ...requestEmail,
  };
  let resolved: BillPayResolution;
  let enrichmentPersistence: BillEnrichmentPersistence = "not_persisted";
  if (serverContext?.candidate && !serverContext.candidate.semantic_enrichment) {
    resolved = await enrichBillCandidate(userId, {
      email: effectiveEmail,
      candidate: serverContext.candidate,
      metadata: mappingMetadata,
      source,
      dbClient,
    }, { candidateVerification });
    const persisted = await compareAndSwapBillCandidate(userId, serverContext, resolved.bill, dbClient);
    enrichmentPersistence = persisted ? "newly_persisted" : "cas_lost";
    if (!persisted) {
      const winner = await loadServerBillCandidate(userId, {
        emailId: serverContext.emailId,
        accountId: serverContext.accountId,
      }, { dbClient });
      if (winner?.candidate) {
        resolved = await resolveConfiguredBillPay({
          settings,
          metadata: mappingMetadata,
          source,
          email: { ...winner.email, ...requestEmail },
          candidate: winner.candidate,
          candidateVerification,
          allowProviderCalls: false,
        });
      }
    }
  } else {
    if (serverContext?.candidate?.semantic_enrichment) enrichmentPersistence = "already_persisted";
    resolved = await resolveConfiguredBillPay({
      settings,
      metadata: mappingMetadata,
      source,
      email: effectiveEmail,
      candidate: serverContext?.candidate || candidate,
      candidateVerification,
      allowProviderCalls: !serverContext?.candidate?.semantic_enrichment,
    });
  }
  try {
    emitSemanticHealthTelemetry(billSemanticHealthTelemetry({
      userId,
      accountId: serverContext?.accountId || accountId,
      emailId: serverContext?.emailId || emailId,
      source,
      resolution: resolved,
      persistence: enrichmentPersistence,
    }));
  } catch {
    // Diagnostic telemetry must never alter bill resolution.
  }
  const dueDate = resolved.bill?.due_date || null;
  let occurrenceData: OccurrenceData = {
    schedules: [],
    syncHealth: metadata.syncHealth,
  };
  if (dueDate) {
    occurrenceData = await occurrenceReader(
      userId,
      { start: dueDate, end: dueDate },
      { dbClient },
    ).catch((error: unknown) => ({
      schedules: [],
      syncHealth: {
        state: "unavailable",
        lastSuccessAt: metadata.syncHealth?.lastSuccessAt || null,
        lastError: error instanceof Error ? error.message : null,
      },
    }));
  }

  const today = todayYmd(now);
  let transactionData: TransactionQueryResult = { transactions: [] };
  if (dueDate && dueDate <= today) {
    transactionData = await transactionReader(userId, {
      start: dueDate,
      end: dueDate,
      direction: "all",
      include_transfers: true,
      limit: 100,
    });
  }
  const reconciliationHealth = transactionData.error || transactionData.sync_state
    ? {
        state: transactionData.sync_state || "unavailable",
        lastSuccessAt: occurrenceData.syncHealth?.lastSuccessAt || metadata.syncHealth?.lastSuccessAt || null,
        lastError: transactionData.error || null,
      }
    : occurrenceData.syncHealth || metadata.syncHealth;

  return {
    ...resolved,
    actualStatus: resolveStatementActualStatus({
      bill: resolved.bill,
      metadata,
      occurrences: occurrenceData.schedules || [],
      transactions: transactionData.transactions || [],
      syncHealth: reconciliationHealth,
      today,
    }),
  };
}
