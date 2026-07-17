import { isDemoMode } from "./demo/config.ts";
import type { OwnerClaimResponse, SetupStatusResponse } from "../shared/types/setup.ts";

function responseError(body: unknown, status: number): Error {
  const message = typeof body === "object" && body !== null && "message" in body
    ? String((body as { message?: unknown }).message || "")
    : "";
  return new Error(message || `API error: ${status}`);
}

async function setupFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Setpoint",
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw responseError(body, response.status);
  }
  return response.json() as Promise<T>;
}

export const getSetupStatus = (): Promise<SetupStatusResponse> => (
  isDemoMode() ? Promise.resolve({ claimed: true }) : setupFetch<SetupStatusResponse>("/api/auth/setup/status")
);

export const claimOwner = (password: string): Promise<OwnerClaimResponse> => {
  if (isDemoMode()) return Promise.reject(new Error("DEMO_API_UNHANDLED"));
  return setupFetch<OwnerClaimResponse>("/api/auth/setup/claim", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
};
