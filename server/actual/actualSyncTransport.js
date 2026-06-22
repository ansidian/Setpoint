import { readFile, writeFile } from "fs/promises";
import path from "path";
import { Timestamp, fromBinary, SyncResponseSchema } from "@actual-app/crdt";
import { encodeSyncRequest, verifyEncodedSyncRequest, syncPayloadSummary } from "./actualCrdtWire.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export function timeoutMs() {
  const value = Number(process.env.EA_ACTUAL_LIGHTWEIGHT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

export async function fetchActualJson(url, { token = null, body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let response;
  let text = "";
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-ACTUAL-TOKEN": token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    text = await response.text();
  } catch (err) {
    throw Object.assign(new Error(err?.name === "AbortError"
      ? "Actual Budget lightweight write request timed out"
      : "Actual Budget server is unreachable"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw Object.assign(new Error(`Actual Budget returned non-JSON response: ${text.slice(0, 120)}`), { status: 502 });
  }
}

export async function loginActual(config) {
  if (!config.password) {
    throw Object.assign(new Error("Actual Budget password is required for lightweight writes"), { status: 400 });
  }
  const login = await fetchActualJson(`${config.serverURL}/account/login`, {
    body: { password: config.password, loginMethod: "password" },
  });
  const token = login?.data?.token;
  if (!token) throw Object.assign(new Error("Actual Budget login did not return a session token"), { status: 502 });
  return token;
}

export async function postActualSync(config, token, { metadata, messages }) {
  const since = metadata.lastSyncedTimestamp
    || new Timestamp(Date.now() - 5 * 60 * 1000, 0, "0").toString();
  const payload = {
    groupId: metadata.groupId,
    cloudFileId: metadata.cloudFileId,
    since,
    messages,
  };
  const buffer = encodeSyncRequest(payload);
  verifyEncodedSyncRequest(buffer, payload);
  console.log(`[EA] Actual lightweight sync: pushing ${messages.length} message(s) ${JSON.stringify(syncPayloadSummary(messages))} since ${since}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(`${config.serverURL}/sync/sync`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Length": String(buffer.length),
        "Content-Type": "application/actual-sync",
        "X-ACTUAL-TOKEN": token,
      },
      body: buffer,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw Object.assign(new Error(`Actual Budget lightweight sync failed: ${text.slice(0, 120) || response.status}`), {
        status: response.status >= 500 ? 502 : 400,
      });
    }
    const responseBuffer = await response.arrayBuffer();
    const responsePb = fromBinary(SyncResponseSchema, new Uint8Array(responseBuffer));
    const merkleText = responsePb.merkle;
    return {
      messageCount: responsePb.messages.length,
      merkle: merkleText ? JSON.parse(merkleText) : null,
    };
  } catch (err) {
    if (err?.status) throw err;
    throw Object.assign(new Error(err?.name === "AbortError"
      ? "Actual Budget lightweight sync timed out"
      : "Actual Budget lightweight sync failed"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

export async function saveBudgetMetadata(budgetDir, metadata) {
  await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify(metadata));
}

export async function readBudgetMetadata(budgetDir) {
  return JSON.parse(await readFile(path.join(budgetDir, "metadata.json"), "utf8"));
}
