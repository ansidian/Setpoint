import { isDemoMode } from "@/demo/config";
import type {
  OwnerAuthMode,
  OwnerRecoveryResponse,
  RecoveryCodesResponse,
} from "../../shared/types/accounts";

async function securityFetch<T>(path: string, options: RequestInit): Promise<T> {
  if (isDemoMode()) throw new Error("DEMO_API_UNHANDLED");
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Setpoint",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = typeof body === "object" && body !== null && "message" in body
      ? String((body as { message?: unknown }).message || "")
      : "";
    throw new Error(message || `API error: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const stepUpWithPassword = (password: string): Promise<{ recentAuth: true }> => securityFetch(
  "/api/auth/security/step-up/password",
  { method: "POST", body: JSON.stringify({ password }) },
);

export const updateOwnerAuthMode = (authMode: OwnerAuthMode): Promise<{ authMode: OwnerAuthMode; recentAuth: true }> => securityFetch(
  "/api/auth/security/auth-mode",
  { method: "PATCH", body: JSON.stringify({ authMode }) },
);

export const changeOwnerPassword = (newPassword: string): Promise<{ success: true; recentAuth: true }> => securityFetch(
  "/api/auth/security/password",
  { method: "POST", body: JSON.stringify({ newPassword }) },
);

export const regenerateRecoveryCodes = (): Promise<RecoveryCodesResponse> => securityFetch(
  "/api/auth/recovery-codes/regenerate",
  { method: "POST" },
);

export const recoverOwnerAccess = (recoveryCode: string, newPassword: string): Promise<OwnerRecoveryResponse> => securityFetch(
  "/api/auth/recovery",
  { method: "POST", body: JSON.stringify({ recoveryCode, newPassword }) },
);
