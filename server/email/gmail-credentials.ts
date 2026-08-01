import db from "../db/connection.ts";
import { findCanonicalGmailAccount, normalizeEmailAddress } from "../platform/account-canonical.ts";
import { accountCredentialContext } from "../platform/credential-encryption-context.ts";
import { canonicalUrlService } from "../platform/canonical-url.ts";
import { decrypt, encrypt } from "../platform/encryption.ts";
import { fetchWithTimeout } from "../platform/fetch-with-timeout.ts";
import {
  clearAccountNeedsReauth,
  isInvalidGrantError,
  markAccountNeedsReauth,
} from "../platform/provider-reauth.ts";
import {
  googleOAuthCredentialManager,
  type GoogleOAuthApplicationCredentials,
} from "../google-oauth-credentials.ts";
import { GOOGLE_COMBINED_SCOPES } from "./gmail-oauth-url.ts";
import type { ConfiguredEmailAccount } from "./email-provider-types.ts";
import { emailErrorMessage } from "./email-provider-types.ts";

interface GmailCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scopes: string[];
}

interface GmailTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface GmailProfileResponse {
  emailAddress?: string;
}

const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;
const PROFILE_FETCH_TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_TIMEOUT_MS = 10_000;
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

function computeExpiresAt(expiresIn: unknown, now = Date.now()): number {
  const ttl = typeof expiresIn === "number" && Number.isFinite(expiresIn)
    ? expiresIn
    : DEFAULT_TOKEN_TTL_SECONDS;
  return now + ttl * 1000;
}

export async function handleCallback(
  code: string,
  _accountId: string | null | undefined,
  userId: string,
  applicationCredentials: GoogleOAuthApplicationCredentials,
  onValidated?: () => Promise<void>,
): Promise<{ email: string; accountId: string }> {
  const redirectUri = await canonicalUrlService.resolveProviderCallbackUrl("googleOAuth");
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: applicationCredentials.clientId,
      client_secret: applicationCredentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  }, { timeoutMs: TOKEN_EXCHANGE_TIMEOUT_MS });

  if (!res.ok) {
    throw new Error(`Google OAuth token exchange failed (${res.status})`);
  }

  const tokens = await res.json() as GmailTokenResponse;
  const credentials: GmailCredentials = {
    access_token: tokens.access_token || "",
    refresh_token: tokens.refresh_token || "",
    expires_at: computeExpiresAt(tokens.expires_in),
    scopes: tokens.scope ? tokens.scope.split(" ").filter(Boolean) : GOOGLE_COMBINED_SCOPES,
  };

  const profileRes = await fetchWithTimeout(
    "https://www.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: `Bearer ${credentials.access_token}` } },
    { timeoutMs: PROFILE_FETCH_TIMEOUT_MS },
  );
  if (!profileRes.ok) {
    throw new Error(`Google OAuth profile validation failed (${profileRes.status})`);
  }
  const profile = await profileRes.json() as GmailProfileResponse;
  const email = profile.emailAddress || "";
  if (!email) throw new Error("Google OAuth profile did not include an email address");
  await onValidated?.();

  const existingAccounts = await db.execute({
    sql: "SELECT * FROM ea_accounts WHERE user_id = ? AND type = 'gmail' ORDER BY sort_order ASC, created_at ASC",
    args: [userId],
  });
  const canonical = findCanonicalGmailAccount(existingAccounts.rows, email) as unknown as ConfiguredEmailAccount | null;
  const targetAccountId = canonical?.id || `gmail-${normalizeEmailAddress(email)}`;

  let nextSort = canonical?.sort_order;
  if (nextSort == null) {
    const maxSort = await db.execute({
      sql: "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ea_accounts WHERE user_id = ?",
      args: [userId],
    });
    nextSort = Number(maxSort.rows[0]?.next);
  }

  await db.execute({
    sql: `INSERT INTO ea_accounts (id, user_id, type, email, label, credentials_encrypted, sort_order)
          VALUES (?, ?, 'gmail', ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            credentials_encrypted = excluded.credentials_encrypted,
            email = excluded.email,
            needs_reauth = 0,
            updated_at = datetime('now')`,
    args: [
      targetAccountId,
      userId,
      email,
      canonical?.label || email,
      encrypt(JSON.stringify(credentials), accountCredentialContext(targetAccountId)),
      nextSort,
    ],
  });

  return { email, accountId: targetAccountId };
}

export async function getAccessToken(account: ConfiguredEmailAccount): Promise<string> {
  const canonicalAccountId = account.canonical_id || account.id;
  const credentials = JSON.parse(
    decrypt(account.credentials_encrypted, accountCredentialContext(canonicalAccountId)),
  ) as GmailCredentials;

  const expiresAt = credentials.expires_at;
  const isExpiring = !Number.isFinite(expiresAt) || expiresAt < Date.now() + 5 * 60 * 1000;
  if (!isExpiring) return credentials.access_token;

  const applicationCredentials = await googleOAuthCredentialManager.resolveActive();
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: applicationCredentials.clientId,
      client_secret: applicationCredentials.clientSecret,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    }),
  }, { timeoutMs: TOKEN_REFRESH_TIMEOUT_MS });

  if (!res.ok) {
    const text = await res.text();
    if (isInvalidGrantError(text)) {
      await markAccountNeedsReauth(canonicalAccountId).catch((error: unknown) =>
        console.error("[Gmail] Failed to mark needs_reauth:", emailErrorMessage(error)));
    }
    throw new Error(`Token refresh failed for ${account.email}: ${text}`);
  }

  const data = await res.json() as GmailTokenResponse;
  credentials.access_token = data.access_token || "";
  credentials.expires_at = computeExpiresAt(data.expires_in);
  if (data.refresh_token) credentials.refresh_token = data.refresh_token;
  if (data.scope) credentials.scopes = data.scope.split(" ").filter(Boolean);

  await db.execute({
    sql: `UPDATE ea_accounts SET credentials_encrypted = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [
      encrypt(JSON.stringify(credentials), accountCredentialContext(canonicalAccountId)),
      canonicalAccountId,
    ],
  });

  if (account.needs_reauth) {
    await clearAccountNeedsReauth(canonicalAccountId).catch((error: unknown) =>
      console.error("[Gmail] Failed to clear needs_reauth:", emailErrorMessage(error)));
  }

  return credentials.access_token;
}
