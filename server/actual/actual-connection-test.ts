import { decrypt } from "../platform/encryption.ts";
import db from "../db/connection.ts";
import type { ActualConfig } from "../../shared/types/actual.ts";

interface ActualConnectionOverrides {
  serverURL?: string;
  syncId?: string;
  password?: string | null;
}
interface ActualErrorBody {
  status?: string;
  reason?: string;
  description?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function trimServerUrl(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function joinUrl(base: string, path: string): string {
  return `${trimServerUrl(base)}${path}`;
}

function timeoutMs(): number {
  const value = Number(process.env.EA_ACTUAL_TEST_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

async function getActualConfig(userId: string): Promise<ActualConfig> {
  const result = await db.execute({
    sql: "SELECT actual_budget_url, actual_budget_password_encrypted, actual_budget_sync_id FROM ea_settings WHERE user_id = ?",
    args: [userId],
  });
  const settings = result.rows?.[0];
  if (!settings?.actual_budget_url || !settings?.actual_budget_sync_id) {
    throw Object.assign(new Error("Actual Budget not configured in EA settings"), { status: 400 });
  }
  return {
    serverURL: trimServerUrl(settings.actual_budget_url),
    password: settings.actual_budget_password_encrypted
      ? decrypt(String(settings.actual_budget_password_encrypted))
      : null,
    syncId: String(settings.actual_budget_sync_id),
  };
}

async function fetchJson<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let response: Response;
  let bodyText = "";
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.headers || {}),
        "Content-Type": "application/json",
      },
    });
    bodyText = await response.text();
  } catch (err: unknown) {
    const message = err instanceof Error && err.name === "AbortError"
      ? "Actual Budget connection test timed out"
      : "Actual Budget server is unreachable";
    throw Object.assign(new Error(message), { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  let body: ActualErrorBody | null = null;
  try {
    body = bodyText ? JSON.parse(bodyText) as ActualErrorBody : null;
  } catch {
    throw Object.assign(new Error("Actual Budget server returned an invalid response"), { status: 502 });
  }

  if (!response.ok || body?.status === "error") {
    const reason = body?.reason || body?.description || bodyText || `HTTP ${response.status}`;
    // SEC-05: do not reflect the remote server's response body back to the
    // client (partial-response SSRF oracle) — log the real reason server-side
    // only and throw a generic, status-derived message.
    console.error(`Actual Budget connection test failed (HTTP ${response.status}): ${reason}`);
    throw Object.assign(new Error(`Actual Budget connection failed (HTTP ${response.status})`), {
      status: response.status >= 500 ? 502 : 400,
    });
  }
  return body as T;
}

export async function testActualConnectionHttp(userId: string, overrides: ActualConnectionOverrides | null = null): Promise<{ success: true; budgetCount: number; budgetFound: boolean }> {
  const stored = overrides?.serverURL && overrides?.syncId
    ? await getActualConfig(userId).catch(() => null)
    : await getActualConfig(userId);
  const serverURL = trimServerUrl(overrides?.serverURL || stored?.serverURL);
  const syncId = String(overrides?.syncId || stored?.syncId || "").trim();
  const password = overrides?.password || stored?.password || null;

  if (!serverURL || !syncId) {
    throw Object.assign(new Error("Actual Budget server URL and sync ID are required"), { status: 400 });
  }
  if (!password) {
    throw Object.assign(new Error("Actual Budget password is required to test the hosted connection"), { status: 400 });
  }

  const login = await fetchJson<{ data?: { token?: string } }>(joinUrl(serverURL, "/account/login"), {
    method: "POST",
    body: JSON.stringify({ password, loginMethod: "password" }),
  });
  const token = login?.data?.token;
  if (!token) {
    throw Object.assign(new Error("Actual Budget login did not return a session token"), { status: 502 });
  }

  const files = await fetchJson<{ data?: Array<{ groupId?: string }> }>(joinUrl(serverURL, "/sync/list-user-files"), {
    headers: { "X-ACTUAL-TOKEN": token },
  });
  const budgets = Array.isArray(files?.data) ? files.data : [];
  return {
    success: true,
    budgetCount: budgets.length,
    budgetFound: budgets.some((budget) => budget?.groupId === syncId),
  };
}
