import db from "../db/connection.ts";
import type { Client, Row } from "@libsql/client";
import type { InstanceCredentialValidationState } from "../../shared/types/instance-credentials.ts";
import {
  isInstanceCredentialKey,
  type InstanceCredentialKey,
} from "./instance-credential-registry.ts";

type InstanceCredentialDb = Pick<Client, "execute" | "transaction">;
type InstanceCredentialExecutor = Pick<Client, "execute">;

export const INSTANCE_CREDENTIAL_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export type InstanceCredentialRecord = {
  key: InstanceCredentialKey;
  activeValueEncrypted: string | null;
  pendingValueEncrypted: string | null;
  pendingStagedAt: number | null;
  pendingExpiresAt: number | null;
  disabled: boolean;
  validationState: InstanceCredentialValidationState;
  lastTestedAt: number | null;
  lastSucceededAt: number | null;
  lastFailedAt: number | null;
  errorCode: string | null;
  version: number;
  updatedAt: number;
};

export class InstanceCredentialConflictError extends Error {
  readonly code = "INSTANCE_CREDENTIAL_CONFLICT";
  readonly status = 409;

  constructor() {
    super("Credential changed before this operation completed");
  }
}

export class UnsupportedInstanceCredentialKeyError extends Error {
  readonly code = "UNKNOWN_INSTANCE_CREDENTIAL";

  constructor() {
    super("Credential key is not supported");
  }
}

function assertSupportedKey(key: string): asserts key is InstanceCredentialKey {
  if (!isInstanceCredentialKey(key)) throw new UnsupportedInstanceCredentialKeyError();
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function recordFromRow(row: Row): InstanceCredentialRecord {
  return {
    key: String(row.credential_key) as InstanceCredentialKey,
    activeValueEncrypted: nullableString(row.active_value_encrypted),
    pendingValueEncrypted: nullableString(row.pending_value_encrypted),
    pendingStagedAt: nullableNumber(row.pending_staged_at),
    pendingExpiresAt: nullableNumber(row.pending_expires_at),
    disabled: Number(row.disabled) === 1,
    validationState: String(row.validation_state) as InstanceCredentialValidationState,
    lastTestedAt: nullableNumber(row.last_tested_at),
    lastSucceededAt: nullableNumber(row.last_succeeded_at),
    lastFailedAt: nullableNumber(row.last_failed_at),
    errorCode: nullableString(row.error_code),
    version: Number(row.version),
    updatedAt: Number(row.updated_at),
  };
}

const SELECT_COLUMNS = `credential_key, active_value_encrypted, pending_value_encrypted,
  pending_staged_at, pending_expires_at,
  disabled, validation_state, last_tested_at, last_succeeded_at, last_failed_at,
  error_code, version, updated_at`;

export function createInstanceCredentialStore(dbClient: InstanceCredentialDb = db) {
  async function pruneExpiredPendingWith(executor: InstanceCredentialExecutor, now: number): Promise<void> {
    await executor.execute({
      sql: `UPDATE ea_instance_credentials SET
              pending_value_encrypted = NULL,
              pending_staged_at = NULL,
              pending_expires_at = NULL,
              validation_state = CASE
                WHEN disabled = 1 THEN 'disabled'
                WHEN active_value_encrypted IS NOT NULL AND last_succeeded_at IS NOT NULL THEN 'valid'
                ELSE 'untested'
              END,
              error_code = NULL,
              version = version + 1,
              updated_at = ?
            WHERE pending_value_encrypted IS NOT NULL AND (
              pending_expires_at IS NULL OR pending_expires_at <= ?
              OR (
                credential_key IN ('google.oauth_client_id', 'google.oauth_client_secret')
                AND EXISTS (
                  SELECT 1 FROM ea_instance_credentials expired
                  WHERE expired.credential_key IN ('google.oauth_client_id', 'google.oauth_client_secret')
                    AND expired.pending_value_encrypted IS NOT NULL
                    AND (expired.pending_expires_at IS NULL OR expired.pending_expires_at <= ?)
                )
              )
              OR (
                credential_key IN ('tasks.todoist_client_id', 'tasks.todoist_client_secret')
                AND EXISTS (
                  SELECT 1 FROM ea_instance_credentials expired
                  WHERE expired.credential_key IN ('tasks.todoist_client_id', 'tasks.todoist_client_secret')
                    AND expired.pending_value_encrypted IS NOT NULL
                    AND (expired.pending_expires_at IS NULL OR expired.pending_expires_at <= ?)
                )
              )
            )`,
      args: [now, now, now, now],
    });
  }

  async function pruneExpiredPending(now = Date.now()): Promise<void> {
    const tx = await dbClient.transaction("write");
    try {
      await pruneExpiredPendingWith(tx, now);
      await tx.commit();
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    }
  }

  async function get(key: InstanceCredentialKey, now = Date.now()): Promise<InstanceCredentialRecord | null> {
    assertSupportedKey(key);
    let result = await dbClient.execute({
      sql: `SELECT ${SELECT_COLUMNS} FROM ea_instance_credentials WHERE credential_key = ?`,
      args: [key],
    });
    const row = result.rows[0];
    if (row?.pending_value_encrypted
      && (nullableNumber(row.pending_expires_at) === null || Number(row.pending_expires_at) <= now)) {
      await pruneExpiredPending(now);
      result = await dbClient.execute({
        sql: `SELECT ${SELECT_COLUMNS} FROM ea_instance_credentials WHERE credential_key = ?`,
        args: [key],
      });
    }
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }

  async function list(now = Date.now()): Promise<InstanceCredentialRecord[]> {
    let result = await dbClient.execute(
      `SELECT ${SELECT_COLUMNS} FROM ea_instance_credentials ORDER BY credential_key`,
    );
    if (result.rows.some((row) => row.pending_value_encrypted
      && (nullableNumber(row.pending_expires_at) === null || Number(row.pending_expires_at) <= now))) {
      await pruneExpiredPending(now);
      result = await dbClient.execute(
        `SELECT ${SELECT_COLUMNS} FROM ea_instance_credentials ORDER BY credential_key`,
      );
    }
    return result.rows.map(recordFromRow);
  }

  async function stagePending(key: InstanceCredentialKey, encryptedValue: string, now = Date.now()): Promise<InstanceCredentialRecord> {
    assertSupportedKey(key);
    await dbClient.execute({
      sql: `INSERT INTO ea_instance_credentials
              (credential_key, pending_value_encrypted, pending_staged_at, pending_expires_at,
               disabled, validation_state, version, updated_at)
            VALUES (?, ?, ?, ?, 0, 'pending', 1, ?)
            ON CONFLICT(credential_key) DO UPDATE SET
              pending_value_encrypted = excluded.pending_value_encrypted,
              pending_staged_at = excluded.pending_staged_at,
              pending_expires_at = excluded.pending_expires_at,
              validation_state = 'pending',
              error_code = NULL,
              version = ea_instance_credentials.version + 1,
              updated_at = excluded.updated_at`,
      args: [key, encryptedValue, now, now + INSTANCE_CREDENTIAL_PENDING_TTL_MS, now],
    });
    return (await get(key, now))!;
  }

  async function stagePendingGroup(
    entries: Array<{ key: InstanceCredentialKey; encryptedValue: string }>,
    now = Date.now(),
  ): Promise<InstanceCredentialRecord[]> {
    for (const entry of entries) assertSupportedKey(entry.key);
    const tx = await dbClient.transaction("write");
    try {
      for (const entry of entries) {
        await tx.execute({
          sql: `INSERT INTO ea_instance_credentials
                  (credential_key, pending_value_encrypted, pending_staged_at, pending_expires_at,
                   disabled, validation_state, version, updated_at)
                VALUES (?, ?, ?, ?, 0, 'pending', 1, ?)
                ON CONFLICT(credential_key) DO UPDATE SET
                  pending_value_encrypted = excluded.pending_value_encrypted,
                  pending_staged_at = excluded.pending_staged_at,
                  pending_expires_at = excluded.pending_expires_at,
                  validation_state = 'pending',
                  error_code = NULL,
                  version = ea_instance_credentials.version + 1,
                  updated_at = excluded.updated_at`,
          args: [entry.key, entry.encryptedValue, now, now + INSTANCE_CREDENTIAL_PENDING_TTL_MS, now],
        });
      }
      const records: InstanceCredentialRecord[] = [];
      for (const entry of entries) {
        const selected = await tx.execute({
          sql: `SELECT ${SELECT_COLUMNS} FROM ea_instance_credentials WHERE credential_key = ?`,
          args: [entry.key],
        });
        records.push(recordFromRow(selected.rows[0]!));
      }
      await tx.commit();
      return records;
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    }
  }

  async function importActive(key: InstanceCredentialKey, encryptedValue: string, now = Date.now()): Promise<InstanceCredentialRecord> {
    assertSupportedKey(key);
    await dbClient.execute({
      sql: `INSERT INTO ea_instance_credentials
              (credential_key, active_value_encrypted, disabled, validation_state, version, updated_at)
            VALUES (?, ?, 0, 'untested', 1, ?)
            ON CONFLICT(credential_key) DO UPDATE SET
              active_value_encrypted = excluded.active_value_encrypted,
              pending_value_encrypted = NULL,
              pending_staged_at = NULL,
              pending_expires_at = NULL,
              disabled = 0,
              validation_state = 'untested',
              error_code = NULL,
              version = ea_instance_credentials.version + 1,
              updated_at = excluded.updated_at`,
      args: [key, encryptedValue, now],
    });
    return (await get(key, now))!;
  }

  async function importActiveGroup(
    entries: Array<{ key: InstanceCredentialKey; encryptedValue: string }>,
    now = Date.now(),
  ): Promise<InstanceCredentialRecord[]> {
    for (const entry of entries) assertSupportedKey(entry.key);
    const tx = await dbClient.transaction("write");
    try {
      for (const entry of entries) {
        await tx.execute({
          sql: `INSERT INTO ea_instance_credentials
                  (credential_key, active_value_encrypted, disabled, validation_state, version, updated_at)
                VALUES (?, ?, 0, 'untested', 1, ?)
                ON CONFLICT(credential_key) DO UPDATE SET
                  active_value_encrypted = excluded.active_value_encrypted,
                  pending_value_encrypted = NULL,
                  pending_staged_at = NULL,
                  pending_expires_at = NULL,
                  disabled = 0,
                  validation_state = 'untested',
                  error_code = NULL,
                  version = ea_instance_credentials.version + 1,
                  updated_at = excluded.updated_at`,
          args: [entry.key, entry.encryptedValue, now],
        });
      }
      const records: InstanceCredentialRecord[] = [];
      for (const entry of entries) {
        const selected = await tx.execute({
          sql: `SELECT ${SELECT_COLUMNS} FROM ea_instance_credentials WHERE credential_key = ?`,
          args: [entry.key],
        });
        records.push(recordFromRow(selected.rows[0]!));
      }
      await tx.commit();
      return records;
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    }
  }

  async function promotePending(key: InstanceCredentialKey, expectedVersion: number, now = Date.now()): Promise<InstanceCredentialRecord> {
    assertSupportedKey(key);
    const tx = await dbClient.transaction("write");
    try {
      await pruneExpiredPendingWith(tx, now);
      const result = await tx.execute({
        sql: `UPDATE ea_instance_credentials SET
                active_value_encrypted = pending_value_encrypted,
                pending_value_encrypted = NULL,
                pending_staged_at = NULL,
                pending_expires_at = NULL,
                disabled = 0,
                validation_state = 'valid',
                last_tested_at = ?,
                last_succeeded_at = ?,
                error_code = NULL,
                version = version + 1,
                updated_at = ?
              WHERE credential_key = ? AND version = ? AND pending_value_encrypted IS NOT NULL
                AND pending_expires_at > ?`,
        args: [now, now, now, key, expectedVersion, now],
      });
      if (result.rowsAffected !== 1) throw new InstanceCredentialConflictError();
      const selected = await tx.execute({
        sql: `SELECT ${SELECT_COLUMNS} FROM ea_instance_credentials WHERE credential_key = ?`,
        args: [key],
      });
      await tx.commit();
      return recordFromRow(selected.rows[0]!);
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    }
  }

  async function promotePendingGroup(
    entries: Array<{ key: InstanceCredentialKey; expectedVersion: number }>,
    now = Date.now(),
  ): Promise<InstanceCredentialRecord[]> {
    for (const entry of entries) assertSupportedKey(entry.key);
    const tx = await dbClient.transaction("write");
    try {
      await pruneExpiredPendingWith(tx, now);
      for (const entry of entries) {
        const result = await tx.execute({
          sql: `UPDATE ea_instance_credentials SET
                  active_value_encrypted = pending_value_encrypted,
                  pending_value_encrypted = NULL,
                  pending_staged_at = NULL,
                  pending_expires_at = NULL,
                  disabled = 0,
                  validation_state = 'valid',
                  last_tested_at = ?,
                  last_succeeded_at = ?,
                  error_code = NULL,
                  version = version + 1,
                  updated_at = ?
                WHERE credential_key = ? AND version = ? AND pending_value_encrypted IS NOT NULL
                  AND pending_expires_at > ?`,
          args: [now, now, now, entry.key, entry.expectedVersion, now],
        });
        if (result.rowsAffected !== 1) throw new InstanceCredentialConflictError();
      }
      const records: InstanceCredentialRecord[] = [];
      for (const entry of entries) {
        const selected = await tx.execute({
          sql: `SELECT ${SELECT_COLUMNS} FROM ea_instance_credentials WHERE credential_key = ?`,
          args: [entry.key],
        });
        records.push(recordFromRow(selected.rows[0]!));
      }
      await tx.commit();
      return records;
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    }
  }

  async function recordPendingFailure(
    key: InstanceCredentialKey,
    expectedVersion: number,
    errorCode: string,
    now = Date.now(),
  ): Promise<InstanceCredentialRecord> {
    assertSupportedKey(key);
    const tx = await dbClient.transaction("write");
    try {
      await pruneExpiredPendingWith(tx, now);
      const result = await tx.execute({
        sql: `UPDATE ea_instance_credentials SET
              validation_state = 'invalid',
              last_tested_at = ?,
              last_failed_at = ?,
              error_code = ?,
              version = version + 1,
              updated_at = ?
            WHERE credential_key = ? AND version = ? AND pending_value_encrypted IS NOT NULL
              AND pending_expires_at > ?`,
        args: [now, now, errorCode, now, key, expectedVersion, now],
      });
      if (result.rowsAffected !== 1) throw new InstanceCredentialConflictError();
      const selected = await tx.execute({
        sql: `SELECT ${SELECT_COLUMNS} FROM ea_instance_credentials WHERE credential_key = ?`,
        args: [key],
      });
      await tx.commit();
      return recordFromRow(selected.rows[0]!);
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    }
  }

  async function discardPending(
    key: InstanceCredentialKey,
    expectedVersion: number,
    now = Date.now(),
  ): Promise<InstanceCredentialRecord> {
    const records = await discardPendingGroup([{ key, expectedVersion }], now);
    return records[0]!;
  }

  async function discardPendingGroup(
    entries: Array<{ key: InstanceCredentialKey; expectedVersion: number }>,
    now = Date.now(),
  ): Promise<InstanceCredentialRecord[]> {
    for (const entry of entries) assertSupportedKey(entry.key);
    const tx = await dbClient.transaction("write");
    try {
      await pruneExpiredPendingWith(tx, now);
      for (const entry of entries) {
        const result = await tx.execute({
          sql: `UPDATE ea_instance_credentials SET
                  pending_value_encrypted = NULL,
                  pending_staged_at = NULL,
                  pending_expires_at = NULL,
                  validation_state = CASE
                    WHEN disabled = 1 THEN 'disabled'
                    WHEN active_value_encrypted IS NOT NULL AND last_succeeded_at IS NOT NULL THEN 'valid'
                    ELSE 'untested'
                  END,
                  error_code = NULL,
                  version = version + 1,
                  updated_at = ?
                WHERE credential_key = ? AND version = ? AND pending_value_encrypted IS NOT NULL
                  AND pending_expires_at > ?`,
          args: [now, entry.key, entry.expectedVersion, now],
        });
        if (result.rowsAffected !== 1) throw new InstanceCredentialConflictError();
      }
      const records: InstanceCredentialRecord[] = [];
      for (const entry of entries) {
        const selected = await tx.execute({
          sql: `SELECT ${SELECT_COLUMNS} FROM ea_instance_credentials WHERE credential_key = ?`,
          args: [entry.key],
        });
        records.push(recordFromRow(selected.rows[0]!));
      }
      await tx.commit();
      return records;
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    }
  }

  async function disable(key: InstanceCredentialKey, now = Date.now()): Promise<InstanceCredentialRecord> {
    assertSupportedKey(key);
    await dbClient.execute({
      sql: `INSERT INTO ea_instance_credentials
              (credential_key, disabled, validation_state, version, updated_at)
            VALUES (?, 1, 'disabled', 1, ?)
            ON CONFLICT(credential_key) DO UPDATE SET
              active_value_encrypted = NULL,
              pending_value_encrypted = NULL,
              pending_staged_at = NULL,
              pending_expires_at = NULL,
              disabled = 1,
              validation_state = 'disabled',
              error_code = NULL,
              version = ea_instance_credentials.version + 1,
              updated_at = excluded.updated_at`,
      args: [key, now],
    });
    return (await get(key, now))!;
  }

  async function disableGroup(
    keys: InstanceCredentialKey[],
    now = Date.now(),
  ): Promise<InstanceCredentialRecord[]> {
    for (const key of keys) assertSupportedKey(key);
    const tx = await dbClient.transaction("write");
    try {
      for (const key of keys) {
        await tx.execute({
          sql: `INSERT INTO ea_instance_credentials
                  (credential_key, disabled, validation_state, version, updated_at)
                VALUES (?, 1, 'disabled', 1, ?)
                ON CONFLICT(credential_key) DO UPDATE SET
                  active_value_encrypted = NULL,
                  pending_value_encrypted = NULL,
                  pending_staged_at = NULL,
                  pending_expires_at = NULL,
                  disabled = 1,
                  validation_state = 'disabled',
                  error_code = NULL,
                  version = ea_instance_credentials.version + 1,
                  updated_at = excluded.updated_at`,
          args: [key, now],
        });
      }
      const records: InstanceCredentialRecord[] = [];
      for (const key of keys) {
        const selected = await tx.execute({
          sql: `SELECT ${SELECT_COLUMNS} FROM ea_instance_credentials WHERE credential_key = ?`,
          args: [key],
        });
        records.push(recordFromRow(selected.rows[0]!));
      }
      await tx.commit();
      return records;
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    }
  }

  async function useHostValue(key: InstanceCredentialKey): Promise<void> {
    assertSupportedKey(key);
    await dbClient.execute({
      sql: "DELETE FROM ea_instance_credentials WHERE credential_key = ?",
      args: [key],
    });
  }

  async function useHostValueGroup(keys: InstanceCredentialKey[]): Promise<void> {
    for (const key of keys) assertSupportedKey(key);
    const tx = await dbClient.transaction("write");
    try {
      for (const key of keys) {
        await tx.execute({
          sql: "DELETE FROM ea_instance_credentials WHERE credential_key = ?",
          args: [key],
        });
      }
      await tx.commit();
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    }
  }

  return {
    get,
    list,
    stagePending,
    stagePendingGroup,
    importActive,
    importActiveGroup,
    promotePending,
    promotePendingGroup,
    recordPendingFailure,
    discardPending,
    discardPendingGroup,
    disable,
    disableGroup,
    useHostValue,
    useHostValueGroup,
    pruneExpiredPending,
  };
}

export type InstanceCredentialStore = ReturnType<typeof createInstanceCredentialStore>;
export const instanceCredentialStore = createInstanceCredentialStore();
