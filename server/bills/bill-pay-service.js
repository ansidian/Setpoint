import db from "../db/connection.ts";
import { getMetadata as actualGetMetadata } from "../actual/actual.ts";
import { getMetadata as projectedGetMetadata } from "../actual/actual-metadata-projection.ts";
import { readBillsMirrorRange } from "./bills-mirror-sync.js";
import { queryTransactions } from "../transactions/transactions-service.js";
import { parseBillPayMappingsJson } from "./bill-pay-mappings.js";
import { resolveBillPayMapping } from "./bill-pay-resolver.js";
import { resolveStatementActualStatus } from "./statementActualStatusModel.js";

async function loadBillPayMappings(userId, { dbClient = db } = {}) {
  try {
    const result = await dbClient.execute({
      sql: "SELECT bill_pay_mappings_json FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    return parseBillPayMappingsJson(result.rows?.[0]?.bill_pay_mappings_json);
  } catch {
    return parseBillPayMappingsJson(null);
  }
}

async function loadServerBillCandidate(userId, { emailId, accountId = null }, { dbClient = db } = {}) {
  if (!emailId) return null;
  const accountFilter = accountId ? "AND t.account_id = ?" : "";
  const args = accountId ? [userId, emailId, accountId] : [userId, emailId];
  const result = await dbClient.execute({
    sql: `SELECT t.bill_candidate_json,
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
      candidate = JSON.parse(row.bill_candidate_json);
    } catch {
      candidate = null;
    }
  }
  return {
    candidate,
    email: {
      from: [row.from_name, row.from_address].filter(Boolean).join(" "),
      from_address: row.from_address || "",
      subject: row.subject || "",
      snippet: row.body_snippet || "",
      body: row.body_text || "",
    },
  };
}

async function loadBillPayMetadata(userId) {
  try {
    return await actualGetMetadata(userId);
  } catch {
    return { accounts: [], categories: [], payees: [] };
  }
}

function todayYmd(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function unavailableMetadata(error = null) {
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
      lastError: error?.message || null,
    },
  };
}

export async function resolveBillPaySeed(userId, payload = {}, options = {}) {
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
    occurrenceReader = readBillsMirrorRange,
    transactionReader = queryTransactions,
    now = new Date(),
  } = options;
  const [mappings, serverContext, metadata] = await Promise.all([
    loadBillPayMappings(userId, { dbClient }),
    loadServerBillCandidate(userId, { emailId, accountId }, { dbClient }),
    metadataReader(userId).catch((error) => unavailableMetadata(error)),
  ]);
  const requestEmail = {
    ...email,
    ...(subject !== undefined ? { subject } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
  };
  const mappingMetadata = metadata.syncHealth?.state === "current" ? metadata : {};
  const resolved = resolveBillPayMapping({
    mappings,
    metadata: mappingMetadata,
    source,
    email: {
      ...(serverContext?.email || {}),
      ...requestEmail,
    },
    candidate: serverContext?.candidate || candidate,
  });
  const dueDate = resolved.bill?.due_date || null;
  let occurrenceData = {
    schedules: [],
    syncHealth: metadata.syncHealth,
  };
  if (dueDate) {
    occurrenceData = await occurrenceReader(
      userId,
      { start: dueDate, end: dueDate },
      { dbClient },
    ).catch((error) => ({
      schedules: [],
      syncHealth: {
        state: "unavailable",
        lastSuccessAt: metadata.syncHealth?.lastSuccessAt || null,
        lastError: error?.message || null,
      },
    }));
  }

  const today = todayYmd(now);
  let transactionData = { transactions: [] };
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

export async function resolveBillPaySample(userId, {
  mappings = null,
  email = {},
  candidate = null,
  metadata = null,
  dbClient = db,
} = {}) {
  const [effectiveMappings, effectiveMetadata] = await Promise.all([
    mappings ? Promise.resolve(parseBillPayMappingsJson(JSON.stringify(mappings))) : loadBillPayMappings(userId, { dbClient }),
    metadata ? Promise.resolve(metadata) : loadBillPayMetadata(userId),
  ]);
  return resolveBillPayMapping({
    mappings: effectiveMappings,
    metadata: effectiveMetadata,
    source: "pasted_text",
    email,
    candidate,
  });
}

export async function resolveExtractedBillPay(userId, {
  extracted,
  metadata,
  email,
} = {}) {
  return resolveBillPayMapping({
    mappings: await loadBillPayMappings(userId),
    metadata,
    source: "extract",
    email,
    candidate: extracted,
  });
}
