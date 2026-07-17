import { createClient } from "@libsql/client";
import { resolveDatabaseClientConfig } from "../../db/config.ts";
import type { Client } from "@libsql/client";

const DEFAULT_STATUS_LIMIT = 25;
const MAX_BACKFILL_LIMIT = 500;

type EmailSearchHarnessAdapter = "local" | "turso";
type EmailSearchHarnessCommand = "status" | "backfill";

type ParsedHarnessArgs = Record<string, string | undefined>;

interface HarnessParseOptions {
  command?: EmailSearchHarnessCommand;
  defaultAdapter?: EmailSearchHarnessAdapter;
}

export interface EmailSearchHarnessArgs {
  adapter: EmailSearchHarnessAdapter;
  limit: number | null;
  batchSize: number;
  userId: string | undefined;
  json: boolean;
}

export interface EmailSearchHarnessDbOptions {
  adapter?: EmailSearchHarnessAdapter;
  env?: NodeJS.ProcessEnv;
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
  defaultAdapter = "local",
}: HarnessParseOptions = {}): EmailSearchHarnessArgs {
  const args = parseArgv(argv);
  const adapterText = String(args.adapter || defaultAdapter).toLowerCase();
  const adapter: EmailSearchHarnessAdapter = adapterText === "turso" ? "turso" : "local";
  if (!["local", "turso"].includes(adapterText)) {
    throw new Error("Invalid --adapter. Use --adapter=local or --adapter=turso.");
  }

  const limit = parsePositiveInt(args.limit, {
    fallback: command === "backfill" ? null : DEFAULT_STATUS_LIMIT,
    max: MAX_BACKFILL_LIMIT,
  });
  if (command === "backfill" && !limit) {
    throw new Error("A bounded --limit is required for email-search embedding backfill.");
  }

  return {
    adapter,
    limit,
    batchSize: parsePositiveInt(args.batchSize, { fallback: 16, max: 100 })!,
    userId: args.userId || process.env.EA_USER_ID,
    json: args.json === "1" || args.json === "true",
  };
}

export function resolveEmailSearchHarnessDbConfig({ adapter = "local", env = process.env }: EmailSearchHarnessDbOptions = {}): ReturnType<typeof resolveDatabaseClientConfig> {
  if (adapter === "turso") {
    return resolveDatabaseClientConfig({
      ...env,
      EA_DEV_DB_ADAPTER: "turso",
      AI_SEARCH_VECTOR_ADAPTER: "turso",
    });
  }
  return resolveDatabaseClientConfig({
    ...env,
    NODE_ENV: env.NODE_ENV === "production" ? "development" : env.NODE_ENV,
    EA_DEV_DB_ADAPTER: "",
    AI_SEARCH_VECTOR_ADAPTER: "",
  });
}

export function createEmailSearchHarnessDb(options: EmailSearchHarnessDbOptions = {}): EmailSearchHarnessDb {
  const config = resolveEmailSearchHarnessDbConfig(options);
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
