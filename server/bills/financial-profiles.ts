import type { InStatement } from "@libsql/client";
import db from "../db/connection.ts";
import type { ActualMetadata, ActualSchedule } from "../../shared/types/actual.ts";
import type { FinancialProfile, FinancialProfileConfiguration, FinancialProfileTarget } from "../../shared/types/financial-profiles.ts";
import { transferScheduleTopology } from "./financialEmailAccountEvidence.ts";

type ProfileValidation =
  | { valid: true; value: FinancialProfile[] }
  | { valid: false; message: string };

interface ProfileDb {
  execute(statement: InStatement): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const PROFILE_KEYS = ["id", "name", "enabled", "budgetId", "senderAddresses", "merchantName", "accountLast4", "target"];
const EMAIL_ADDRESS = /^[a-z0-9.!#$%&'+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function boundedString(value: unknown, limit: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= limit
    && [...value].every((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127);
}

function invalid(message: string): ProfileValidation {
  return { valid: false, message: `Invalid financial_profiles: ${message}` };
}

function targetShape(value: unknown): FinancialProfileTarget | null {
  if (!object(value)) return null;
  if (value.kind === "utility") {
    return onlyKeys(value, ["kind", "scheduleId"]) && boundedString(value.scheduleId, 128)
      ? { kind: "utility", scheduleId: value.scheduleId.trim() } : null;
  }
  if (value.kind === "card_payment") {
    if (!onlyKeys(value, ["kind", "fromAccountId", "toAccountId", "scheduleId"])
      || !boundedString(value.fromAccountId, 128) || !boundedString(value.toAccountId, 128)
      || (value.scheduleId !== undefined && !boundedString(value.scheduleId, 128))) return null;
    return {
      kind: "card_payment", fromAccountId: value.fromAccountId.trim(), toAccountId: value.toAccountId.trim(),
      ...(typeof value.scheduleId === "string" ? { scheduleId: value.scheduleId.trim() } : {}),
    };
  }
  if (value.kind === "expense" || value.kind === "income") {
    if (!onlyKeys(value, ["kind", "accountId", "payeeId", "categoryId"])
      || !boundedString(value.accountId, 128) || !boundedString(value.payeeId, 128)
      || (value.categoryId != null && !boundedString(value.categoryId, 128))) return null;
    return {
      kind: value.kind, accountId: value.accountId.trim(), payeeId: value.payeeId.trim(),
      ...(value.categoryId !== undefined ? { categoryId: typeof value.categoryId === "string" ? value.categoryId.trim() : null } : {}),
    };
  }
  return null;
}

function profileShapes(value: unknown): ProfileValidation {
  if (!Array.isArray(value) || value.length > 100) return invalid("provide an array of at most 100 profiles");
  const ids = new Set<string>();
  const profiles: FinancialProfile[] = [];
  for (const raw of value) {
    if (!object(raw) || !onlyKeys(raw, PROFILE_KEYS)) return invalid("profiles must contain only the supported fields");
    if (!boundedString(raw.id, 128) || !boundedString(raw.name, 120) || !boundedString(raw.budgetId, 128)) {
      return invalid("each profile needs an ID, a name of at most 120 characters, and a budget ID of at most 128 characters");
    }
    if (ids.has(raw.id.trim())) return invalid("profile IDs must be unique");
    ids.add(raw.id.trim());
    if (typeof raw.enabled !== "boolean") return invalid("enabled must be a boolean");
    if (!Array.isArray(raw.senderAddresses) || !raw.senderAddresses.length || raw.senderAddresses.length > 20) {
      return invalid("each profile needs 1–20 exact sender email addresses");
    }
    const senders = new Set<string>();
    for (const address of raw.senderAddresses) {
      if (!boundedString(address, 254)) return invalid("sender addresses must be exact email addresses of at most 254 characters");
      const normalized = address.trim().toLowerCase();
      const local = normalized.split("@")[0]!;
      if (!EMAIL_ADDRESS.test(normalized) || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
        return invalid("sender addresses must be exact email addresses, without names or wildcards");
      }
      if (senders.has(normalized)) return invalid("sender addresses within a profile must be unique");
      senders.add(normalized);
    }
    if (raw.merchantName !== undefined && !boundedString(raw.merchantName, 200)) return invalid("merchantName must be an exact name of at most 200 characters");
    if (raw.accountLast4 !== undefined && (typeof raw.accountLast4 !== "string" || !/^\d{4}$/.test(raw.accountLast4))) return invalid("accountLast4 must contain exactly four digits");
    const target = targetShape(raw.target);
    if (!target) return invalid("each target must contain exactly the fields required for its kind");
    profiles.push({
      id: raw.id.trim(), name: raw.name.trim(), enabled: raw.enabled, budgetId: raw.budgetId.trim(),
      senderAddresses: [...senders], target,
      ...(typeof raw.merchantName === "string" ? { merchantName: raw.merchantName.trim() } : {}),
      ...(typeof raw.accountLast4 === "string" ? { accountLast4: raw.accountLast4 } : {}),
    });
  }
  return { valid: true, value: profiles };
}

function exactConditionId(schedule: ActualSchedule, aliases: string[]): string | null {
  const conditions = schedule.conditions?.filter((condition) => aliases.includes(String(condition.field))) || [];
  return conditions.length === 1 && conditions[0]!.op === "is" && typeof conditions[0]!.value === "string"
    ? conditions[0]!.value : null;
}

function unavailableTarget(profile: FinancialProfile, metadata: ActualMetadata): string | null {
  const target = profile.target;
  const openAccount = (id: string | null) => metadata.accounts.some((account) => account.id === id && !account.closed);
  const nonTransferPayee = (id: string | null) => metadata.payees.some((payee) => payee.id === id && !payee.transfer_acct);
  if ("accountId" in target) {
    if (!openAccount(target.accountId)) return "the account is closed or unavailable";
    if (!nonTransferPayee(target.payeeId)) return "the payee is unavailable or is a transfer payee";
    if (target.categoryId && !metadata.categories.some((group) => group.categories.some((category) => category.id === target.categoryId))) return "the category is unavailable";
    return null;
  }
  if (target.kind === "card_payment") {
    if (target.fromAccountId === target.toAccountId) return "the funding account and card account must be different";
    if (!openAccount(target.fromAccountId) || !openAccount(target.toAccountId)) return "a payment account is closed or unavailable";
    if (!target.scheduleId) return null;
  }
  const schedules = metadata.schedules.filter((schedule) => schedule.id === target.scheduleId);
  if (schedules.length !== 1) return "the schedule is unavailable or is not unique";
  const schedule = schedules[0]!;
  const accountId = exactConditionId(schedule, ["account", "acct"]);
  const payeeId = exactConditionId(schedule, ["payee", "description"]);
  if (!openAccount(accountId) || !payeeId) return "the schedule needs an exact open account and payee";
  if (target.kind === "utility") {
    return schedule.type === "bill" && nonTransferPayee(payeeId) && !schedule.transferAccountId
      ? null : "the utility schedule must be a bill with a non-transfer payee";
  }
  const topology = transferScheduleTopology(schedule);
  // Metadata omits transfer payees; schedule classification retains their account.
  return topology !== null && topology.fromAccountId === target.fromAccountId && topology.toAccountId === target.toAccountId
    ? null : "the schedule must transfer from the selected funding account to the selected card";
}

function authority(profile: FinancialProfile): string {
  return JSON.stringify([
    profile.budgetId, [...profile.senderAddresses].sort(), profile.merchantName ?? null,
    profile.accountLast4 ?? null, profile.target,
  ]);
}

/** Existing unchanged authority may remain during repair; runtime still revalidates it. */
export function validateFinancialProfiles(value: unknown, {
  budgetId, metadata, existingProfiles = [],
}: { budgetId: string | null; metadata: ActualMetadata | null; existingProfiles?: FinancialProfile[] }): ProfileValidation {
  const parsed = profileShapes(value);
  if (!parsed.valid) return parsed;
  for (const profile of parsed.value) {
    if (!profile.enabled) continue;
    const existing = existingProfiles.find((entry) => entry.id === profile.id && entry.enabled);
    if (existing && authority(existing) === authority(profile)) continue;
    if (!budgetId || profile.budgetId !== budgetId) return invalid(`${profile.name}: select the currently connected Actual budget before enabling this profile`);
    if (!metadata) return invalid("Actual Budget metadata is unavailable; refresh it before enabling profiles");
    const problem = unavailableTarget(profile, metadata);
    if (problem) return invalid(`${profile.name}: ${problem}`);
  }
  return parsed;
}

/** Missing or malformed configuration grants no automation authority. */
export function financialProfilesFromSettingsRow(row: Record<string, unknown> | undefined): FinancialProfileConfiguration {
  let profiles: FinancialProfile[] = [];
  try {
    const parsed = profileShapes(JSON.parse(String(row?.financial_profiles_json || "[]")));
    if (parsed.valid) profiles = parsed.value;
  } catch { /* Corrupt saved JSON must not authorize an inferred target. */ }
  const revision = Number(row?.financial_profiles_revision ?? 0);
  return {
    budgetId: typeof row?.actual_budget_sync_id === "string" && row.actual_budget_sync_id.trim() ? row.actual_budget_sync_id : null,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    profiles,
  };
}

export async function readFinancialProfiles(userId: string, { dbClient = db }: { dbClient?: ProfileDb } = {}): Promise<FinancialProfileConfiguration> {
  const result = await dbClient.execute({
    sql: "SELECT actual_budget_sync_id, financial_profiles_json, financial_profiles_revision FROM ea_settings WHERE user_id = ?",
    args: [userId],
  });
  return financialProfilesFromSettingsRow(result.rows[0]);
}
