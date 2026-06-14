import { decrypt } from "../platform/encryption.js";
import db from "../db/connection.js";

const DEFAULT_TIMEOUT_MS = 10_000;

function trimServerUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function joinUrl(base, path) {
  return `${trimServerUrl(base)}${path}`;
}

function timeoutMs() {
  const value = Number(process.env.EA_ACTUAL_TEST_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

async function getActualConfig(userId) {
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
      ? decrypt(settings.actual_budget_password_encrypted)
      : null,
    syncId: settings.actual_budget_sync_id,
  };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let response;
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
  } catch (err) {
    const message = err?.name === "AbortError"
      ? "Actual Budget connection test timed out"
      : "Actual Budget server is unreachable";
    throw Object.assign(new Error(message), { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  let body = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    throw Object.assign(new Error("Actual Budget server returned an invalid response"), { status: 502 });
  }

  if (!response.ok || body?.status === "error") {
    const reason = body?.reason || body?.description || bodyText || `HTTP ${response.status}`;
    throw Object.assign(new Error(`Actual Budget connection failed: ${reason}`), {
      status: response.status >= 500 ? 502 : 400,
    });
  }
  return body;
}

export async function testActualConnectionHttp(userId, overrides = null) {
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

  const login = await fetchJson(joinUrl(serverURL, "/account/login"), {
    method: "POST",
    body: JSON.stringify({ password, loginMethod: "password" }),
  });
  const token = login?.data?.token;
  if (!token) {
    throw Object.assign(new Error("Actual Budget login did not return a session token"), { status: 502 });
  }

  const files = await fetchJson(joinUrl(serverURL, "/sync/list-user-files"), {
    headers: { "X-ACTUAL-TOKEN": token },
  });
  const budgets = Array.isArray(files?.data) ? files.data : [];
  return {
    success: true,
    budgetCount: budgets.length,
    budgetFound: budgets.some((budget) => budget?.groupId === syncId),
  };
}
