import { createClient } from "@libsql/client";
import { resolveDatabaseClientConfig } from "../../db/config.ts";
import type { Client } from "@libsql/client";

const DEFAULT_STATUS_LIMIT = 25;
const MAX_BACKFILL_LIMIT = 500;

type EmailSearchHarnessCommand = "status" | "backfill";

type ParsedHarnessArgs = Record<string, string | undefined>;

interface HarnessParseOptions {
  command?: EmailSearchHarnessCommand;
}

export interface EmailSearchHarnessArgs {
  limit: number | null;
  batchSize: number;
  userId: string | undefined;
  json: boolean;
}

export interface EmailSearchHarnessDb {
  config: ReturnType<typeof resolveDatabaseClientConfig>;
  dbClient: Client;
}

function parsePositiveInt(value: unknown, { fallback = null, max = Number.MAX_SAFE_INTEGER }: { fallback?: number | null; max?: number } = {}): number | null {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseArgv(argv: string[] = []): ParsedHarnessArgs {
  const out: ParsedHarnessArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (!rawKey) continue;
    const key = rawKey.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    if (inlineValue != null) {
      out[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = "1";
    }
  }
  return out;
}

export function parseEmailSearchHarnessArgs(argv: string[] = [], {
  command = "status",
}: HarnessParseOptions = {}): EmailSearchHarnessArgs {
  const args = parseArgv(argv);

  const limit = parsePositiveInt(args.limit, {
    fallback: command === "backfill" ? null : DEFAULT_STATUS_LIMIT,
    max: MAX_BACKFILL_LIMIT,
  });
  if (command === "backfill" && !limit) {
    throw new Error("A bounded --limit is required for email-search embedding backfill.");
  }

  return {
    limit,
    batchSize: parsePositiveInt(args.batchSize, { fallback: 16, max: 100 })!,
    userId: args.userId || process.env.EA_USER_ID,
    json: args.json === "1" || args.json === "true",
  };
}

export function createEmailSearchHarnessDb(env: NodeJS.ProcessEnv = process.env): EmailSearchHarnessDb {
  const config = resolveDatabaseClientConfig(env);
  return {
    config,
    dbClient: createClient(config.client),
  };
}

export function requireHarnessUserId(userId: string | null | undefined): string {
  if (!userId) {
    throw new Error("EA_USER_ID is required. Pass --user-id=<id> or set EA_USER_ID.");
  }
  return userId;
}
