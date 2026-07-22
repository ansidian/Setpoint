import db from "../db/connection.ts";
import type { Client } from "@libsql/client";

const GOOGLE_CALLBACK_PATH = "/api/ea/accounts/gmail/callback";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type CanonicalUrlSource = "owner_confirmed" | "legacy_import";

export type CanonicalUrlProjection = {
  canonicalOrigin: string;
  webAuthn: {
    rpName: "Setpoint";
    rpId: string;
    origin: string;
  };
  callbacks: {
    googleOAuth: string;
    todoistOAuth: string;
    gmailPubSub: string;
    todoistWebhook: string;
  };
};

export type ProviderCallback = keyof CanonicalUrlProjection["callbacks"];

export type CanonicalOriginImpact = {
  currentOrigin: string | null;
  proposedOrigin: string;
  affectedPasskeys: number;
  callbacks: Array<{
    provider: string;
    previousUrl: string | null;
    nextUrl: string;
  }>;
};

type CanonicalUrlDb = Pick<Client, "execute">;

function parseUrl(value: unknown): URL {
  if (typeof value !== "string" || !value.trim() || value.includes(",")) {
    throw new Error("Canonical URL is invalid");
  }
  try {
    return new URL(value.trim());
  } catch {
    throw new Error("Canonical URL is invalid");
  }
}

export function normalizeCanonicalOrigin(
  value: unknown,
  { production = process.env.NODE_ENV === "production" }: { production?: boolean } = {},
): string {
  const parsed = parseUrl(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Canonical URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Canonical URL must contain only an origin");
  }
  if (production && parsed.protocol !== "https:") {
    throw new Error("Canonical URL must use HTTPS");
  }
  if (!production && parsed.protocol !== "https:" && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("Non-local canonical URLs must use HTTPS");
  }
  return parsed.origin;
}

export function deriveCanonicalUrls(canonicalOrigin: string): CanonicalUrlProjection {
  const origin = new URL(canonicalOrigin).origin;
  const hostname = new URL(origin).hostname.toLowerCase();
  return {
    canonicalOrigin: origin,
    webAuthn: { rpName: "Setpoint", rpId: hostname, origin },
    callbacks: {
      googleOAuth: `${origin}${GOOGLE_CALLBACK_PATH}`,
      todoistOAuth: `${origin}/api/ea/accounts/todoist/callback`,
      gmailPubSub: `${origin}/api/gmail/push`,
      todoistWebhook: `${origin}/api/todoist/webhook`,
    },
  };
}

export function buildCanonicalOriginImpact(
  currentOrigin: string | null,
  proposedOrigin: string,
  affectedPasskeys: number,
): CanonicalOriginImpact {
  const next = deriveCanonicalUrls(proposedOrigin);
  const previous = currentOrigin ? deriveCanonicalUrls(currentOrigin) : null;
  const callbackLabels: Array<[keyof CanonicalUrlProjection["callbacks"], string]> = [
    ["googleOAuth", "Google OAuth"],
    ["todoistOAuth", "Todoist OAuth"],
    ["gmailPubSub", "Gmail Pub/Sub"],
    ["todoistWebhook", "Todoist webhook"],
  ];
  return {
    currentOrigin,
    proposedOrigin: next.canonicalOrigin,
    affectedPasskeys,
    callbacks: callbackLabels.map(([key, provider]) => ({
      provider,
      previousUrl: previous?.callbacks[key] ?? null,
      nextUrl: next.callbacks[key],
    })),
  };
}

function legacyRedirectOrigin(value: string | undefined, production: boolean): string | null {
  if (!value) return null;
  try {
    const parsed = parseUrl(value);
    if (parsed.pathname !== GOOGLE_CALLBACK_PATH || parsed.search || parsed.hash) return null;
    return normalizeCanonicalOrigin(parsed.origin, { production });
  } catch {
    return null;
  }
}

export function resolveLegacyCanonicalOrigin(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string | null {
  const production = env.NODE_ENV === "production";
  const candidates: string[] = [];
  if (env.EA_WEBAUTHN_ORIGIN) {
    try {
      candidates.push(normalizeCanonicalOrigin(env.EA_WEBAUTHN_ORIGIN, { production }));
    } catch {
      return null;
    }
  }
  const redirectOrigin = legacyRedirectOrigin(env.GOOGLE_REDIRECT_URI, production);
  if (env.GOOGLE_REDIRECT_URI && !redirectOrigin) return null;
  if (redirectOrigin) candidates.push(redirectOrigin);

  if (!candidates.length && env.EA_WEBAUTHN_RP_ID) {
    try {
      candidates.push(normalizeCanonicalOrigin(
        `${production ? "https" : "http"}://${env.EA_WEBAUTHN_RP_ID}`,
        { production },
      ));
    } catch {
      return null;
    }
  }
  if (!candidates.length) return null;
  if (new Set(candidates).size !== 1) return null;

  const canonicalOrigin = candidates[0]!;
  const rpId = env.EA_WEBAUTHN_RP_ID?.trim().toLowerCase();
  if (rpId && new URL(canonicalOrigin).hostname.toLowerCase() !== rpId) return null;
  return canonicalOrigin;
}

export function createCanonicalUrlService(dbClient: CanonicalUrlDb = db) {
  async function getCanonicalOrigin(): Promise<string | null> {
    const result = await dbClient.execute({
      sql: "SELECT canonical_origin FROM ea_instance_metadata WHERE singleton_id = 1",
      args: [],
    });
    return result.rows[0]?.canonical_origin ? String(result.rows[0].canonical_origin) : null;
  }

  async function writeOrigin(origin: string, source: CanonicalUrlSource, now: number): Promise<void> {
    await dbClient.execute({
      sql: `INSERT INTO ea_instance_metadata
              (singleton_id, canonical_origin, source, confirmed_at, updated_at)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(singleton_id) DO UPDATE SET
              canonical_origin = excluded.canonical_origin,
              source = excluded.source,
              confirmed_at = excluded.confirmed_at,
              updated_at = excluded.updated_at`,
      args: [origin, source, now, now],
    });
  }

  async function setConfirmedOrigin(value: unknown, now = Date.now()): Promise<CanonicalUrlProjection> {
    const origin = normalizeCanonicalOrigin(value);
    await writeOrigin(origin, "owner_confirmed", now);
    return deriveCanonicalUrls(origin);
  }

  async function resolveCanonicalOrigin(
    env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
    now = Date.now(),
  ): Promise<string | null> {
    const stored = await getCanonicalOrigin();
    if (stored) return stored;
    if (env.NODE_ENV !== "production") return null;
    const legacy = resolveLegacyCanonicalOrigin(env);
    if (!legacy) return null;
    await writeOrigin(legacy, "legacy_import", now);
    return legacy;
  }

  async function resolveProviderCallbackUrl(
    callback: ProviderCallback,
    env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  ): Promise<string> {
    if (env.NODE_ENV !== "production" && (callback === "googleOAuth" || callback === "todoistOAuth")) {
      const localOrigin = `http://localhost:${env.EA_SERVER_PORT || 3001}`;
      return deriveCanonicalUrls(localOrigin).callbacks[callback];
    }
    const canonicalOrigin = await resolveCanonicalOrigin(env);
    if (canonicalOrigin) return deriveCanonicalUrls(canonicalOrigin).callbacks[callback];
    if (callback === "googleOAuth" && env.NODE_ENV === "production" && env.GOOGLE_REDIRECT_URI) {
      return env.GOOGLE_REDIRECT_URI;
    }
    if (env.NODE_ENV !== "production") {
      const localOrigin = `http://localhost:${env.EA_SERVER_PORT || 3001}`;
      return deriveCanonicalUrls(localOrigin).callbacks[callback];
    }
    throw new Error("Canonical URL is not configured");
  }

  return { getCanonicalOrigin, setConfirmedOrigin, resolveCanonicalOrigin, resolveProviderCallbackUrl };
}

export const canonicalUrlService = createCanonicalUrlService();
