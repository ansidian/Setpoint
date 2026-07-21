import db from "../db/connection.ts";
import type { Client, Row, Value } from "@libsql/client";
import type { AuthenticatorTransportFuture, CredentialDeviceType } from "@simplewebauthn/server";

export type StoredPasskeyCredential = {
  id: number;
  credentialId: string;
  userId: string;
  label: string;
  publicKey: string;
  signCount: number;
  transports: AuthenticatorTransportFuture[];
  backedUp: boolean | null;
  credentialDeviceType: CredentialDeviceType | null;
  createdAt: number;
  lastUsedAt: number | null;
};

export type PasskeyMetadata = Omit<StoredPasskeyCredential, "publicKey">;
type PasskeyDb = Pick<Client, "execute">;

type CreatePasskeyInput = Partial<{
  userId: string;
  credentialId: string;
  label: string;
  publicKey: string;
  signCount: number;
  transports: AuthenticatorTransportFuture[];
  backedUp: boolean | null;
  credentialDeviceType: CredentialDeviceType | null;
  now: number;
}>;

type UpdatePasskeyInput = Partial<{
  signCount: number;
  transports: AuthenticatorTransportFuture[];
  backedUp: boolean | null;
  credentialDeviceType: CredentialDeviceType | null;
  lastUsedAt: number;
}>;

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function boolOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  return Number(value) === 1;
}

function normalizeTransports(transports: unknown): AuthenticatorTransportFuture[] {
  return Array.isArray(transports)
    ? transports.map((transport) => String(transport)).filter(Boolean) as AuthenticatorTransportFuture[]
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value || "");
}

function mapCredential(row: Row | undefined): StoredPasskeyCredential | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    credentialId: stringValue(row.credential_id),
    userId: stringValue(row.user_id),
    label: stringValue(row.label),
    publicKey: stringValue(row.public_key),
    signCount: Number(row.sign_count || 0),
    transports: normalizeTransports(safeJsonParse(row.transports_json || "[]", [])),
    backedUp: boolOrNull(row.backed_up),
    credentialDeviceType: stringValue(row.credential_device_type) as CredentialDeviceType || null,
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at === null || row.last_used_at === undefined ? null : Number(row.last_used_at),
  };
}

export function toPasskeyMetadata(credential: StoredPasskeyCredential | null): PasskeyMetadata | null {
  if (!credential) return null;
  const { publicKey, ...metadata } = credential;
  void publicKey;
  return metadata;
}

export function createPasskeyStore(database: PasskeyDb = db) {
  async function countPasskeys(userId: string) {
    const result = await database.execute({
      sql: "SELECT COUNT(*) AS count FROM ea_passkey_credentials WHERE user_id = ?",
      args: [userId],
    });
    return Number(result.rows[0]?.count || 0);
  }

  async function listPasskeys(userId: string) {
    const result = await database.execute({
      sql: `SELECT * FROM ea_passkey_credentials
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC`,
      args: [userId],
    });
    return result.rows
      .map(mapCredential)
      .filter((credential): credential is StoredPasskeyCredential => credential !== null);
  }

  async function listPasskeyMetadata(userId: string) {
    const credentials = await listPasskeys(userId);
    return credentials.map(toPasskeyMetadata).filter((item): item is PasskeyMetadata => item !== null);
  }

  async function getPasskeyByCredentialId(credentialId: string) {
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
  }: CreatePasskeyInput = {}) {
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

  async function updatePasskeyUsage(credentialId: string, {
    signCount,
    transports,
    backedUp,
    credentialDeviceType,
    lastUsedAt = Date.now(),
  }: UpdatePasskeyInput = {}) {
    const assignments = ["last_used_at = ?"];
    const args: Value[] = [lastUsedAt];
    if (signCount !== undefined) {
      assignments.push("sign_count = MAX(sign_count, ?)");
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

  async function deletePasskey(credentialId: string, userId: string | null = null) {
    const args: Value[] = [credentialId];
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
export const updatePasskeyUsage = passkeyStore.updatePasskeyUsage;
