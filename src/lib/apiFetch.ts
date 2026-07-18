type ApiFetchOptions = RequestInit & {
  redirectOnAuthFailure?: boolean;
  timeoutMs?: number;
};
type ApiError = Error & { code?: unknown; status?: number };
type DemoApiRequestHandler = (path: string, options: ApiFetchOptions) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(value: unknown): string | null {
  const message = isRecord(value) ? value.message : null;
  return message ? String(message) : null;
}

function errorCode(value: unknown): unknown {
  return isRecord(value) ? (value.code || null) : null;
}

export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  // Keep this literal env check so Vite eliminates the demo adapter from production builds.
  if (import.meta.env.VITE_EA_DEMO === "1") {
    const demoModule = await import("../demo/apiAdapter.ts");
    const handleDemoApiRequest = demoModule.handleDemoApiRequest as DemoApiRequestHandler;
    return handleDemoApiRequest(path, options) as Promise<T>;
  }
  const { redirectOnAuthFailure = true, timeoutMs, ...fetchOptions } = options;
  // Only opted-in callers get a deadline; SSE and long-running reads keep their own signals.
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : fetchOptions.signal;

  let res;
  try {
    res = await fetch(path, {
      ...fetchOptions,
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Setpoint",
        ...(fetchOptions.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    if (timeoutMs && isRecord(err) && err.name === "TimeoutError") {
      const timeoutErr = new Error(
        "Request timed out — check the calendar before retrying; the change may not have saved.",
      );
      (timeoutErr as ApiError).code = "request_timeout";
      throw timeoutErr;
    }
    throw err;
  }

  if (res.status === 401 && redirectOnAuthFailure) {
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const error = new Error(errorMessage(body) || `API error: ${res.status}`) as ApiError;
    error.code = errorCode(body);
    error.status = res.status;
    throw error;
  }
  return res.json() as Promise<T>;
}
