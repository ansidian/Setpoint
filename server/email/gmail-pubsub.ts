import crypto from "crypto";
import db from "../db/connection.ts";
import { canonicalUrlService } from "../platform/canonical-url.ts";
import type { InstanceCredentialService } from "../platform/instance-credential-service.ts";
import { registerGmailWatch } from "./gmail-sync.ts";
import type { GmailSyncAccount } from "./email-sync-types.ts";

type PubSubDb = {
  execute(statement: string | { sql: string; args?: unknown[] }): Promise<{ rows: Array<Record<string, unknown>>; rowsAffected?: number }>;
};

type TokenRow = {
  pushTokenHash: string | null;
  tokenDisabled: boolean;
  lastTestedAt: number | null;
  lastSucceededAt: number | null;
  lastFailedAt: number | null;
  errorCode: string | null;
};

const runtimeCredentialService = {
  async resolve(key: string) {
    return (await import("../platform/instance-credential-service.ts")).instanceCredentialService.resolve(key);
  },
  async stagePending(key: string, value: string) {
    return (await import("../platform/instance-credential-service.ts")).instanceCredentialService.stagePending(key, value);
  },
  async promotePending(key: string, version: number) {
    return (await import("../platform/instance-credential-service.ts")).instanceCredentialService.promotePending(key, version);
  },
} as InstanceCredentialService;

export function hashGmailPushToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeHashEqual(candidate: string, expectedHash: string): boolean {
  const candidateHash = Buffer.from(hashGmailPushToken(candidate), "hex");
  const storedHash = Buffer.from(expectedHash, "hex");
  return storedHash.length === candidateHash.length && crypto.timingSafeEqual(candidateHash, storedHash);
}

function validTopic(value: string): boolean {
  return /^projects\/[A-Za-z0-9._:-]+\/topics\/[A-Za-z0-9._~-]+$/.test(value);
}

export class GmailPubSubConfigurationError extends Error {
  readonly status = 400;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function createGmailPubSubService({
  dbClient = db as unknown as PubSubDb,
  credentialService = runtimeCredentialService,
  canonicalUrlResolver = () => canonicalUrlService.resolveProviderCallbackUrl("gmailPubSub"),
  environment = process.env,
  randomToken = () => crypto.randomBytes(32).toString("base64url"),
  registerWatch = registerGmailWatch,
  now = () => Date.now(),
}: {
  dbClient?: PubSubDb;
  credentialService?: InstanceCredentialService;
  canonicalUrlResolver?: () => Promise<string>;
  environment?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  randomToken?: () => string;
  registerWatch?: typeof registerGmailWatch;
  now?: () => number;
} = {}) {
  async function readTokenRow(): Promise<TokenRow | null> {
    const result = await dbClient.execute({
      sql: `SELECT push_token_hash, token_disabled, last_tested_at,
                   last_succeeded_at, last_failed_at, error_code
            FROM ea_gmail_pubsub_config WHERE singleton_id = 1`,
      args: [],
    });
    const row = result.rows[0];
    return row ? {
      pushTokenHash: row.push_token_hash ? String(row.push_token_hash) : null,
      tokenDisabled: Number(row.token_disabled) === 1,
      lastTestedAt: typeof row.last_tested_at === "number" ? row.last_tested_at : null,
      lastSucceededAt: typeof row.last_succeeded_at === "number" ? row.last_succeeded_at : null,
      lastFailedAt: typeof row.last_failed_at === "number" ? row.last_failed_at : null,
      errorCode: row.error_code ? String(row.error_code) : null,
    } : null;
  }

  async function writeToken(pushTokenHash: string | null, tokenDisabled: boolean): Promise<void> {
    await dbClient.execute({
      sql: `INSERT INTO ea_gmail_pubsub_config
              (singleton_id, push_token_hash, token_disabled, updated_at)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(singleton_id) DO UPDATE SET
              push_token_hash = excluded.push_token_hash,
              token_disabled = excluded.token_disabled,
              updated_at = excluded.updated_at`,
      args: [pushTokenHash, tokenDisabled ? 1 : 0, now()],
    });
  }

  async function tokenSource(): Promise<"stored" | "environment" | "disabled" | "absent"> {
    const row = await readTokenRow();
    if (row?.pushTokenHash) return "stored";
    if (row?.tokenDisabled) return "disabled";
    return environment.GMAIL_PUBSUB_PUSH_TOKEN ? "environment" : "absent";
  }

  async function getStatus() {
    const [topic, callbackUrl, pushTokenSource, tokenRow] = await Promise.all([
      credentialService.resolve("gmail.pubsub_topic"),
      canonicalUrlResolver(),
      tokenSource(),
      readTokenRow(),
    ]);
    const configured = Boolean(topic.value) && (pushTokenSource === "stored" || pushTokenSource === "environment");
    return {
      configured,
      healthy: true,
      deliveryMode: configured ? "push_and_periodic" as const : "periodic" as const,
      deliveryStatus: configured ? "near_real_time" as const : "periodic_reconciliation" as const,
      delayedUpdates: !configured,
      topic: { source: topic.source, configured: Boolean(topic.value) },
      pushToken: { source: pushTokenSource, configured: pushTokenSource === "stored" || pushTokenSource === "environment" },
      callbackUrl,
      watchTest: {
        lastTestedAt: tokenRow?.lastTestedAt ?? null,
        lastSucceededAt: tokenRow?.lastSucceededAt ?? null,
        lastFailedAt: tokenRow?.lastFailedAt ?? null,
        errorCode: tokenRow?.errorCode ?? null,
      },
    };
  }

  async function setTopic(value: string) {
    const topic = value.trim();
    if (!validTopic(topic)) {
      throw new GmailPubSubConfigurationError("INVALID_GMAIL_PUBSUB_TOPIC", "Gmail Pub/Sub topic is invalid");
    }
    const pending = await credentialService.stagePending("gmail.pubsub_topic", topic);
    return credentialService.promotePending("gmail.pubsub_topic", pending.version!);
  }

  async function generateCallback() {
    const token = randomToken();
    await writeToken(hashGmailPushToken(token), false);
    const callbackUrl = new URL(await canonicalUrlResolver());
    callbackUrl.searchParams.set("token", token);
    return {
      callbackUrl: callbackUrl.toString(),
      externalSubscriptionUpdateRequired: true,
      status: await getStatus(),
    };
  }

  async function importEnvironmentToken() {
    const token = environment.GMAIL_PUBSUB_PUSH_TOKEN;
    if (!token) {
      throw new GmailPubSubConfigurationError("HOST_GMAIL_PUSH_TOKEN_UNAVAILABLE", "No host Gmail push token is configured");
    }
    await writeToken(hashGmailPushToken(token), false);
    return getStatus();
  }

  async function revokeToken() {
    await writeToken(null, true);
    return getStatus();
  }

  async function useHostToken() {
    if (!environment.GMAIL_PUBSUB_PUSH_TOKEN) {
      throw new GmailPubSubConfigurationError("HOST_GMAIL_PUSH_TOKEN_UNAVAILABLE", "No host Gmail push token is configured");
    }
    await writeToken(null, false);
    return getStatus();
  }

  async function verifyToken(candidate: string): Promise<boolean> {
    if (!candidate) return false;
    const row = await readTokenRow();
    if (row?.pushTokenHash) return safeHashEqual(candidate, row.pushTokenHash);
    if (row?.tokenDisabled) return false;
    const legacyToken = environment.GMAIL_PUBSUB_PUSH_TOKEN;
    return legacyToken ? safeHashEqual(candidate, hashGmailPushToken(legacyToken)) : false;
  }

  async function testWatches() {
    const topic = await credentialService.resolve("gmail.pubsub_topic");
    if (!topic.value) {
      return { ok: false, errorCode: "GMAIL_PUBSUB_TOPIC_NOT_CONFIGURED", checked: 0, registered: 0 };
    }
    const accounts = await dbClient.execute({
      sql: "SELECT * FROM ea_accounts WHERE type = 'gmail' ORDER BY created_at ASC",
      args: [],
    });
    let registered = 0;
    let failed = 0;
    for (const account of accounts.rows as unknown as GmailSyncAccount[]) {
      try {
        await registerWatch(account, { dbClient: dbClient as never, topicName: topic.value });
        registered += 1;
      } catch {
        failed += 1;
      }
    }
    const testedAt = now();
    await dbClient.execute({
      sql: `INSERT INTO ea_gmail_pubsub_config
              (singleton_id, token_disabled, last_tested_at, last_succeeded_at, last_failed_at, error_code, updated_at)
            VALUES (1, 0, ?, ?, ?, ?, ?)
            ON CONFLICT(singleton_id) DO UPDATE SET
              last_tested_at = excluded.last_tested_at,
              last_succeeded_at = excluded.last_succeeded_at,
              last_failed_at = excluded.last_failed_at,
              error_code = excluded.error_code,
              updated_at = excluded.updated_at`,
      args: [testedAt, failed ? null : testedAt, failed ? testedAt : null, failed ? "GMAIL_WATCH_REGISTRATION_FAILED" : null, testedAt],
    });
    return { ok: failed === 0, errorCode: failed ? "GMAIL_WATCH_REGISTRATION_FAILED" : null, checked: accounts.rows.length, registered };
  }

  return {
    getStatus,
    setTopic,
    generateCallback,
    importEnvironmentToken,
    revokeToken,
    useHostToken,
    verifyToken,
    testWatches,
  };
}

export type GmailPubSubService = ReturnType<typeof createGmailPubSubService>;
export const gmailPubSubService = createGmailPubSubService();
