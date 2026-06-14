import db from "../db/connection.js";
import { getMetadata as actualGetMetadata } from "../actual/actual.js";
import { parseBillPayMappingsJson } from "./bill-pay-mappings.js";
import { resolveBillPayMapping } from "./bill-pay-resolver.js";

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

export async function resolveBillPaySeed(userId, {
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
} = {}) {
  const [mappings, serverContext] = await Promise.all([
    loadBillPayMappings(userId, { dbClient }),
    loadServerBillCandidate(userId, { emailId, accountId }, { dbClient }),
  ]);
  const requestEmail = {
    ...email,
    ...(subject !== undefined ? { subject } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
  };
  return resolveBillPayMapping({
    mappings,
    source,
    email: {
      ...(serverContext?.email || {}),
      ...requestEmail,
    },
    candidate: serverContext?.candidate || candidate,
  });
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
