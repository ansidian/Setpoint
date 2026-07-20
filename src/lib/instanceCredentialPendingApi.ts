import type { InstanceCredentialMetadata } from "../../shared/types/instance-credentials.ts";
import { apiFetch } from "./apiFetch.ts";

export const discardInstanceCredentialPending = (
  key: string,
  expectedVersion: number,
): Promise<InstanceCredentialMetadata> => apiFetch(
  `/api/instance-credentials/${encodeURIComponent(key)}/pending`,
  { method: "DELETE", body: JSON.stringify({ expectedVersion }) },
);

export const discardGoogleOAuthPending = (
  candidateVersions: { clientId: number; clientSecret: number },
): Promise<{ credentials: InstanceCredentialMetadata[] }> => apiFetch(
  "/api/instance-credentials/google-oauth/pending",
  { method: "DELETE", body: JSON.stringify({ candidateVersions }) },
);
