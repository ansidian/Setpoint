// Bounded HTTP helpers for worker-owned Actual budget bootstrap.
import { MAX_ACTUAL_ARCHIVE_BYTES } from "./actual-budget-archive.ts";
import type { ActualConfig } from "../../shared/types/actual.ts";

interface FetchActualOptions {
  token?: string | null;
  fileId?: string | null;
  body?: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ACTUAL_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ACTUAL_ERROR_RESPONSE_BYTES = 64 * 1024;

function timeoutMs(): number {
  const value = Number(process.env.EA_ACTUAL_LIGHTWEIGHT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

export async function fetchActualJson<T = unknown>(url: string, { token = null, fileId = null, body = null }: FetchActualOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let text = "";
  try {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-ACTUAL-TOKEN": token } : {}),
        ...(fileId ? { "X-ACTUAL-FILE-ID": fileId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    text = (await readBoundedResponseBody(response, MAX_ACTUAL_JSON_RESPONSE_BYTES)).toString("utf8");
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "status" in err) throw err;
    throw Object.assign(new Error(err instanceof Error && err.name === "AbortError"
      ? "Actual Budget bootstrap request timed out"
      : "Actual Budget server is unreachable"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    throw Object.assign(new Error(`Actual Budget returned non-JSON response: ${text.slice(0, 120)}`), { status: 502 });
  }
}

export async function fetchActualBuffer(url: string, { token, fileId }: { token: string; fileId: string }): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "X-ACTUAL-TOKEN": token,
        "X-ACTUAL-FILE-ID": fileId,
      },
    });
    if (!response.ok) {
      const body = await readBoundedResponseBody(response, MAX_ACTUAL_ERROR_RESPONSE_BYTES);
      const text = body.toString("utf8", 0, 120);
      throw Object.assign(new Error(`Actual Budget file download failed: ${text.slice(0, 120) || response.status}`), {
        status: response.status >= 500 ? 502 : 400,
      });
    }
    return readBoundedResponseBody(response, MAX_ACTUAL_ARCHIVE_BYTES);
  } finally {
    clearTimeout(timer);
  }
}

export async function readBoundedResponseBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw Object.assign(new Error(`Actual Budget file download exceeded the ${maxBytes}-byte limit`), { status: 502 });
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw Object.assign(new Error(`Actual Budget file download exceeded the ${maxBytes}-byte limit`), { status: 502 });
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw Object.assign(new Error(`Actual Budget file download exceeded the ${maxBytes}-byte limit`), { status: 502 });
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function loginActual(config: ActualConfig): Promise<string> {
  if (!config.password) {
    throw Object.assign(new Error("Actual Budget password is required to download the budget"), { status: 400 });
  }
  const login = await fetchActualJson<{ data?: { token?: string } }>(`${config.serverURL}/account/login`, {
    body: { password: config.password, loginMethod: "password" },
  });
  const token = login?.data?.token;
  if (!token) throw Object.assign(new Error("Actual Budget login did not return a session token"), { status: 502 });
  return token;
}
