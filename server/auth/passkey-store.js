import db from "../db/connection.ts";

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function boolOrNull(value) {
  if (value === null || value === undefined) return null;
  return Number(value) === 1;
}

function normalizeTransports(transports) {
  return Array.isArray(transports)
    ? transports.map((transport) => String(transport)).filter(Boolean)
    : [];
}

function mapCredential(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    credentialId: row.credential_id,
    userId: row.user_id,
    label: row.label,
    publicKey: row.public_key,
    signCount: Number(row.sign_count || 0),
    transports: normalizeTransports(safeJsonParse(row.transports_json || "[]", [])),
    backedUp: boolOrNull(row.backed_up),
    credentialDeviceType: row.credential_device_type || null,
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at === null || row.last_used_at === undefined ? null : Number(row.last_used_at),
  };
}

export function toPasskeyMetadata(credential) {
  if (!credential) return null;
  const metadata = { ...credential };
  delete metadata.publicKey;
  return metadata;
}

export function createPasskeyStore(database = db) {
  async function countPasskeys(userId) {
    const result = await database.execute({
      sql: "SELECT COUNT(*) AS count FROM ea_passkey_credentials WHERE user_id = ?",
      args: [userId],
    });
    return Number(result.rows[0]?.count || 0);
  }

  async function listPasskeys(userId) {
    const result = await database.execute({
      sql: `SELECT * FROM ea_passkey_credentials
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC`,
      args: [userId],
    });
    return result.rows.map(mapCredential);
  }

  async function listPasskeyMetadata(userId) {
    const credentials = await listPasskeys(userId);
    return credentials.map(toPasskeyMetadata);
  }

  async function getPasskeyByCredentialId(credentialId) {
    const result = await database.execute({
      sql: "SELECT * FROM ea_passkey_credentials WHERE credential_id = ?",
      args: [credentialId],
    });
    return mapCredential(result.rows[0]);
  }

  async function createPasskey({
    userId,
    credentialId,
    label,
    publicKey,
    signCount = 0,
    transports = [],
    backedUp = null,
    credentialDeviceType = null,
    now = Date.now(),
  } = {}) {
    if (!userId) throw new Error("userId is required");
    if (!credentialId) throw new Error("credentialId is required");
    if (!label?.trim()) throw new Error("label is required");
    if (!publicKey) throw new Error("publicKey is required");

    await database.execute({
      sql: `INSERT INTO ea_passkey_credentials
              (credential_id, user_id, label, public_key, sign_count, transports_json,
               backed_up, credential_device_type, created_at, last_used_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      args: [
        credentialId,
        userId,
        label.trim(),
        publicKey,
        Number(signCount || 0),
        JSON.stringify(normalizeTransports(transports)),
        backedUp === null || backedUp === undefined ? null : (backedUp ? 1 : 0),
        credentialDeviceType,
        now,
      ],
    });
    return getPasskeyByCredentialId(credentialId);
  }

  async function updatePasskeyUsage(credentialId, {
    signCount,
    transports,
    backedUp,
    credentialDeviceType,
    lastUsedAt = Date.now(),
  } = {}) {
    const assignments = ["last_used_at = ?"];
    const args = [lastUsedAt];
    if (signCount !== undefined) {
      assignments.push("sign_count = ?");
      args.push(Number(signCount));
    }
    if (transports !== undefined) {
      assignments.push("transports_json = ?");
      args.push(JSON.stringify(normalizeTransports(transports)));
    }
    if (backedUp !== undefined) {
      assignments.push("backed_up = ?");
      args.push(backedUp === null ? null : (backedUp ? 1 : 0));
    }
    if (credentialDeviceType !== undefined) {
      assignments.push("credential_device_type = ?");
      args.push(credentialDeviceType);
    }
    args.push(credentialId);
    await database.execute({
      sql: `UPDATE ea_passkey_credentials SET ${assignments.join(", ")} WHERE credential_id = ?`,
      args,
    });
    return getPasskeyByCredentialId(credentialId);
  }

  async function deletePasskey(credentialId, userId = null) {
    const args = [credentialId];
    const userClause = userId ? " AND user_id = ?" : "";
    if (userId) args.push(userId);
    const result = await database.execute({
      sql: `DELETE FROM ea_passkey_credentials WHERE credential_id = ?${userClause}`,
      args,
    });
    return Number(result.rowsAffected || 0);
  }

  async function clearPasskeys() {
    await database.execute("DELETE FROM ea_passkey_credentials");
  }

  return {
    countPasskeys,
    listPasskeys,
    listPasskeyMetadata,
    getPasskeyByCredentialId,
    createPasskey,
    updatePasskeyUsage,
    deletePasskey,
    clearPasskeys,
  };
}

const passkeyStore = createPasskeyStore();

export const countPasskeys = passkeyStore.countPasskeys;
export const listPasskeys = passkeyStore.listPasskeys;
export const listPasskeyMetadata = passkeyStore.listPasskeyMetadata;
export const getPasskeyByCredentialId = passkeyStore.getPasskeyByCredentialId;
export const createPasskey = passkeyStore.createPasskey;
export const updatePasskeyUsage = passkeyStore.updatePasskeyUsage;
export const deletePasskey = passkeyStore.deletePasskey;
export const clearPasskeys = passkeyStore.clearPasskeys;
